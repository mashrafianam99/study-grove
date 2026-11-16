package com.mashrafi.studygrove;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.CalendarContract.Calendars;
import android.provider.CalendarContract.Events;
import android.provider.CalendarContract.Reminders;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * Keeps the phone calendar in step with Study Grove's exams. Events go into a phone-only
 * "Study Grove exams" calendar (never synced to an online account), which the phone's own
 * Calendar app shows. Only events this plugin created and recorded are ever changed or deleted.
 */
@CapacitorPlugin(
    name = "ExamCalendar",
    permissions = @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR })
)
public class ExamCalendarPlugin extends Plugin {

    private static final String PREFS = "exam_calendar";
    private static final String ACCOUNT = "Study Grove";
    private static final String MARK = "Added by Study Grove";
    private static final int MAX_EXAMS = 300;
    private static final int MAX_TITLE = 120;
    private static final long DAY_MS = 86_400_000L;
    private static final long REMINDER_LENGTH_MS = 30 * 60_000L;
    private static final int AT_START = 0;
    // For all-day events, a negative offset means "at this time on the day": -480 = 8:00 AM,
    // the same value Xiaomi Calendar stores when you pick 8:00 for an all-day event.
    private static final int EXAM_MORNING = -8 * 60;
    // Xiaomi Calendar keeps its "Alarm reminders" switch in this extended property; without it the
    // reminder is stored but Xiaomi shows it as off. Other calendar apps ignore it.
    private static final String XIAOMI_AGENDA = "agenda_info";
    private static final String XIAOMI_ALARM_ON =
        "{\"need_alarm\":true,\"is_ai\":false,\"is_countdown_reminder\":false,\"extend_agenda_type\":0}";
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,40}");
    private static final Pattern DATE = Pattern.compile("(\\d{4})-(\\d{2})-(\\d{2})");

    // One sync at a time, off the UI thread, in the order they were asked for.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private static final class Exam {
        String id;
        String title;
        String date;
    }

    @PluginMethod
    public void sync(PluginCall call) {
        List<Exam> exams = parse(call.getArray("exams", new JSArray()));
        if (exams == null) {
            call.reject("Invalid exam list");
            return;
        }
        if (getPermissionState("calendar") == PermissionState.GRANTED) run(call, exams);
        else if (hasUpcoming(exams)) requestPermissionForAlias("calendar", call, "permsDone");
        else resolve(call, "denied"); // nothing to add yet, so don't ask
    }

    @PermissionCallback
    private void permsDone(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) run(call, parse(call.getArray("exams", new JSArray())));
        else resolve(call, "denied");
    }

    private void run(PluginCall call, List<Exam> exams) {
        worker.execute(() -> {
            try {
                apply(exams);
                resolve(call, "synced");
            } catch (Exception e) {
                Logger.error("ExamCalendar", "sync failed", e);
                call.reject("Calendar sync failed");
            }
        });
    }

    private void apply(List<Exam> exams) {
        ContentResolver cr = getContext().getContentResolver();
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        SharedPreferences.Editor edit = prefs.edit();
        Map<String, Exam> pending = new HashMap<>();
        for (Exam e : exams) pending.put(e.id, e);
        long calId = calendarId(cr);

        // Stored as examId -> "<signature>|<eventId>,<eventId>". Drop events of deleted or changed exams.
        for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
            String value = String.valueOf(entry.getValue());
            int bar = value.lastIndexOf('|');
            Exam e = pending.get(entry.getKey());
            if (e != null && bar >= 0 && value.substring(0, bar).equals(signature(e))) {
                pending.remove(entry.getKey()); // unchanged: keep its events
                continue;
            }
            if (bar >= 0) deleteEvents(cr, calId, value.substring(bar + 1));
            edit.remove(entry.getKey());
        }
        String today = today();
        for (Exam e : pending.values()) {
            if (e.date.compareTo(today) < 0) continue; // past exams get nothing new
            edit.putString(e.id, signature(e) + "|" + createEvents(cr, calId, e));
        }
        edit.commit(); // before the orphan sweep reads the mapping back
        deleteOrphans(cr, calId, prefs);
    }

    // Removes our own events that no exam points to any more (left behind by earlier versions).
    private static void deleteOrphans(ContentResolver cr, long calId, SharedPreferences prefs) {
        Set<String> keep = new HashSet<>();
        for (Object v : prefs.getAll().values()) {
            String value = String.valueOf(v);
            int bar = value.lastIndexOf('|');
            if (bar >= 0) keep.addAll(Arrays.asList(value.substring(bar + 1).split(",")));
        }
        String where = Events.CALENDAR_ID + "=? AND " + Events.DESCRIPTION + "=?";
        StringBuilder orphans = new StringBuilder();
        try (Cursor c = cr.query(Events.CONTENT_URI, new String[] { Events._ID }, where, new String[] { String.valueOf(calId), MARK }, null)) {
            while (c != null && c.moveToNext()) {
                String id = String.valueOf(c.getLong(0));
                if (!keep.contains(id)) orphans.append(orphans.length() == 0 ? "" : ",").append(id);
            }
        }
        if (orphans.length() > 0) deleteEvents(cr, calId, orphans.toString());
    }

    private static String createEvents(ContentResolver cr, long calId, Exam e) {
        Matcher m = DATE.matcher(e.date);
        if (!m.matches()) return "";
        TimeZone tz = TimeZone.getDefault();
        ExamSchedule plan = ExamSchedule.plan(
            Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)), System.currentTimeMillis(), tz);
        SimpleDateFormat day = new SimpleDateFormat("d MMM", Locale.getDefault());
        day.setTimeZone(TimeZone.getTimeZone("UTC"));
        String examDay = day.format(new Date(plan.examDayUtc));
        List<Long> ids = new ArrayList<>();

        ContentValues exam = base(calId, "Exam: " + e.title, "UTC");
        exam.put(Events.DTSTART, plan.examDayUtc);
        exam.put(Events.DTEND, plan.examDayUtc + DAY_MS);
        exam.put(Events.ALL_DAY, 1);
        add(ids, insert(cr, exam, EXAM_MORNING));

        String study = "Study for " + e.title + " (exam " + examDay + ")";
        if (plan.noon != null) add(ids, insert(cr, daily(calId, study, plan.noon, tz), AT_START));
        if (plan.evening != null) add(ids, insert(cr, daily(calId, study, plan.evening, tz), AT_START));
        if (plan.nightBefore > 0) {
            ContentValues nb = base(calId, "Exam tomorrow: " + e.title, tz.getID());
            nb.put(Events.DTSTART, plan.nightBefore);
            nb.put(Events.DTEND, plan.nightBefore + REMINDER_LENGTH_MS);
            add(ids, insert(cr, nb, AT_START));
        }
        StringBuilder csv = new StringBuilder();
        for (Long id : ids) csv.append(csv.length() == 0 ? "" : ",").append(id);
        return csv.toString();
    }

    private static ContentValues daily(long calId, String title, ExamSchedule.Series s, TimeZone tz) {
        ContentValues v = base(calId, title, tz.getID());
        v.put(Events.DTSTART, s.first);
        v.put(Events.DURATION, "PT30M"); // repeating events take a duration instead of an end time
        // COUNT, not UNTIL: Android's calendar dropped the last day when UNTIL equalled the final
        // occurrence, so a 20 Nov exam lost its 19 Nov 12 pm and 18 Nov 8 pm reminders.
        v.put(Events.RRULE, "FREQ=DAILY;COUNT=" + s.count());
        return v;
    }

    private static ContentValues base(long calId, String title, String tzId) {
        ContentValues v = new ContentValues();
        v.put(Events.CALENDAR_ID, calId);
        v.put(Events.TITLE, title);
        v.put(Events.DESCRIPTION, MARK);
        v.put(Events.EVENT_TIMEZONE, tzId);
        return v;
    }

    // Inserts the event with one pop-up reminder `minutes` before its start. Returns the event id or -1.
    private static long insert(ContentResolver cr, ContentValues v, int minutes) {
        v.put(Events.HAS_ALARM, 1);
        Uri uri = cr.insert(Events.CONTENT_URI, v);
        if (uri == null) return -1;
        long id = Long.parseLong(uri.getLastPathSegment());
        ContentValues r = new ContentValues();
        r.put(Reminders.EVENT_ID, id);
        r.put(Reminders.MINUTES, minutes);
        r.put(Reminders.METHOD, Reminders.METHOD_ALERT);
        cr.insert(Reminders.CONTENT_URI, r);
        ContentValues x = new ContentValues();
        x.put(CalendarContract.ExtendedProperties.EVENT_ID, id);
        x.put(CalendarContract.ExtendedProperties.NAME, XIAOMI_AGENDA);
        x.put(CalendarContract.ExtendedProperties.VALUE, XIAOMI_ALARM_ON);
        // Extended properties may only be written as the calendar's sync adapter, which for our
        // own local calendar we are.
        cr.insert(asSyncAdapter(CalendarContract.ExtendedProperties.CONTENT_URI), x);
        return id;
    }

    private static Uri asSyncAdapter(Uri uri) {
        return uri.buildUpon()
            .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
            .appendQueryParameter(Calendars.ACCOUNT_NAME, ACCOUNT)
            .appendQueryParameter(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            .build();
    }

    private static void add(List<Long> ids, long id) {
        if (id > 0) ids.add(id);
    }

    // Deletes only events in our own calendar whose ids we recorded when creating them.
    private static void deleteEvents(ContentResolver cr, long calId, String csv) {
        for (String part : csv.split(",")) {
            if (!part.matches("\\d{1,19}")) continue;
            cr.delete(asSyncAdapter(Events.CONTENT_URI), Events._ID + "=? AND " + Events.CALENDAR_ID + "=?", new String[] { part, String.valueOf(calId) });
        }
    }

    // Finds our phone-only calendar, creating it the first time.
    private static long calendarId(ContentResolver cr) {
        String where = Calendars.ACCOUNT_NAME + "=? AND " + Calendars.ACCOUNT_TYPE + "=?";
        String[] args = { ACCOUNT, CalendarContract.ACCOUNT_TYPE_LOCAL };
        Uri asSyncAdapter = asSyncAdapter(Calendars.CONTENT_URI);
        try (Cursor c = cr.query(Calendars.CONTENT_URI, new String[] { Calendars._ID }, where, args, null)) {
            if (c != null && c.moveToFirst()) {
                long id = c.getLong(0);
                // Calendars made by the first version lacked these, so reminders showed as off.
                cr.update(ContentUris.withAppendedId(asSyncAdapter, id), reminderSupport(), null, null);
                return id;
            }
        }
        ContentValues v = reminderSupport();
        v.put(Calendars.ACCOUNT_NAME, ACCOUNT);
        v.put(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL);
        v.put(Calendars.NAME, ACCOUNT);
        v.put(Calendars.CALENDAR_DISPLAY_NAME, "Study Grove exams");
        v.put(Calendars.CALENDAR_COLOR, 0xFF3D7A4C);
        v.put(Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CAL_ACCESS_OWNER);
        v.put(Calendars.OWNER_ACCOUNT, ACCOUNT);
        v.put(Calendars.VISIBLE, 1);
        v.put(Calendars.SYNC_EVENTS, 1);
        v.put(Calendars.CALENDAR_TIME_ZONE, TimeZone.getDefault().getID());
        Uri uri = cr.insert(asSyncAdapter, v);
        if (uri == null) throw new IllegalStateException("Could not create the Study Grove calendar");
        return Long.parseLong(uri.getLastPathSegment());
    }

    // Calendar apps (Xiaomi's included) only offer the reminder kinds a calendar declares;
    // without this they show our pop-up reminders as switched off.
    private static ContentValues reminderSupport() {
        ContentValues v = new ContentValues();
        v.put(Calendars.ALLOWED_REMINDERS, Reminders.METHOD_DEFAULT + "," + Reminders.METHOD_ALERT);
        v.put(Calendars.MAX_REMINDERS, 5);
        return v;
    }

    // Bumping the version recreates every exam's events once (v5: daily series by COUNT, so the last day is kept).
    private static String signature(Exam e) {
        return "v5\n" + e.date + "\n" + e.title;
    }

    private static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    private static boolean hasUpcoming(List<Exam> exams) {
        String today = today();
        for (Exam e : exams) if (e.date.compareTo(today) >= 0) return true;
        return false;
    }

    // Validates what the web app sent; returns null if anything is malformed.
    private static List<Exam> parse(JSArray arr) {
        if (arr == null || arr.length() > MAX_EXAMS) return null;
        List<Exam> out = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) return null;
            Exam e = new Exam();
            e.id = o.optString("id", "");
            e.date = o.optString("date", "");
            e.title = o.optString("title", "").replace('|', '/').trim();
            if (!ID.matcher(e.id).matches() || !DATE.matcher(e.date).matches() || e.title.isEmpty()) return null;
            if (e.title.length() > MAX_TITLE) e.title = e.title.substring(0, MAX_TITLE);
            out.add(e);
        }
        return out;
    }

    private static void resolve(PluginCall call, String status) {
        JSObject r = new JSObject();
        r.put("status", status);
        call.resolve(r);
    }
}
