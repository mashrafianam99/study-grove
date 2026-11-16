package com.mashrafi.studygrove;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;
import java.text.DateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * The focus timer as Android sees it: a saved copy of the timer state, the ongoing countdown
 * notification (status bar chip, lock screen, Super Island where the phone supports it) and the
 * alarm that announces the end. Android draws the countdown itself, so nothing ticks in the app.
 */
final class FocusLive {

    static final String ACTION_PAUSE = "com.mashrafi.studygrove.focus.PAUSE";
    static final String ACTION_RESUME = "com.mashrafi.studygrove.focus.RESUME";
    static final String ACTION_STOP = "com.mashrafi.studygrove.focus.STOP";
    static final String ACTION_DONE = "com.mashrafi.studygrove.focus.DONE";

    static final long MAX_SESSION_MS = 4L * 60 * 60 * 1000;
    private static final String PREFS = "focus_live";
    private static final String CH_LIVE = "focus_live";
    private static final String CH_DONE = "focus_done";
    private static final int ID_LIVE = 1;
    private static final int ID_DONE = 2;

    /** Mirrors js/timer.js save(): status idle|running|paused, kind focus|break, times in ms. */
    static final class State {
        String status = "idle";
        String kind = "focus";
        String title = "Focus";
        long endAt;
        long remainingMs;
        long totalMs;
        long updatedAt;
        long endedEarlyMs;
    }

    private FocusLive() {}

    static State load(Context ctx) {
        SharedPreferences p = prefs(ctx);
        State s = new State();
        s.status = p.getString("status", "idle");
        s.kind = p.getString("kind", "focus");
        s.title = p.getString("title", "Focus");
        s.endAt = p.getLong("endAt", 0);
        s.remainingMs = p.getLong("remainingMs", 0);
        s.totalMs = p.getLong("totalMs", 0);
        s.updatedAt = p.getLong("updatedAt", 0);
        s.endedEarlyMs = p.getLong("endedEarlyMs", 0);
        return s;
    }

    static void save(Context ctx, State s) {
        prefs(ctx).edit()
            .putString("status", s.status)
            .putString("kind", s.kind)
            .putString("title", s.title)
            .putLong("endAt", s.endAt)
            .putLong("remainingMs", s.remainingMs)
            .putLong("totalMs", s.totalMs)
            .putLong("updatedAt", s.updatedAt)
            .putLong("endedEarlyMs", s.endedEarlyMs)
            .apply();
    }

    /** A notification button pressed: change the saved state the same way the web timer would. */
    static State apply(Context ctx, String action) {
        State s = load(ctx);
        long now = System.currentTimeMillis();
        if (ACTION_PAUSE.equals(action) && "running".equals(s.status)) {
            s.remainingMs = Math.max(0, s.endAt - now);
            s.status = "paused";
        } else if (ACTION_RESUME.equals(action) && "paused".equals(s.status)) {
            s.endAt = now + s.remainingMs;
            s.status = "running";
        } else if (ACTION_STOP.equals(action) && !"idle".equals(s.status)) {
            long left = "running".equals(s.status) ? Math.max(0, s.endAt - now) : s.remainingMs;
            s.endedEarlyMs = Math.max(0, s.totalMs - left);
            s.status = "idle";
        } else {
            return s;
        }
        s.updatedAt = now;
        save(ctx, s);
        render(ctx, s);
        return s;
    }

    /** Shows, updates or removes the countdown notification and the end alarm to match the state. */
    static void render(Context ctx, State s) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if ("idle".equals(s.status)) {
            nm.cancel(ID_LIVE);
            cancelAlarm(ctx);
            return;
        }
        ensureChannels(ctx);
        boolean running = "running".equals(s.status);
        boolean isBreak = "break".equals(s.kind);
        Notification.Builder b = builder(ctx, CH_LIVE)
            .setSmallIcon(R.drawable.ic_stat_grove)
            .setContentTitle(s.title)
            .setContentIntent(openApp(ctx))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setVisibility(Notification.VISIBILITY_PUBLIC);
        if (running) {
            String ends = DateFormat.getTimeInstance(DateFormat.SHORT, Locale.getDefault()).format(new Date(s.endAt));
            b.setContentText((isBreak ? "Break" : "Focus session") + " · ends " + ends)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
                .setWhen(s.endAt)
                .setShowWhen(true)
                .addAction(action(ctx, ACTION_PAUSE, "Pause"));
        } else {
            b.setContentText("Paused · " + clock(s.remainingMs) + " left")
                .setShowWhen(false)
                .addAction(action(ctx, ACTION_RESUME, "Resume"));
        }
        b.addAction(action(ctx, ACTION_STOP, isBreak ? "End break" : "End session"));
        // Android 16 Live Update: timer chip in the status bar, on the lock screen, and the island
        // on skins that build theirs on Live Updates. This is the extra behind
        // Builder.setRequestPromotedOngoing() (API 36.1, newer than our SDK); older Android ignores it.
        Bundle promote = new Bundle();
        promote.putBoolean("android.requestPromotedOngoing", true);
        b.addExtras(promote);
        nm.notify(ID_LIVE, b.build());
        if (running) scheduleAlarm(ctx, s.endAt);
        else cancelAlarm(ctx);
    }

    /** The alarm went off: the session is over even though the app may not be running. */
    static void announceDone(Context ctx) {
        State s = load(ctx);
        if (!"running".equals(s.status)) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        nm.cancel(ID_LIVE);
        ensureChannels(ctx);
        boolean isBreak = "break".equals(s.kind);
        Notification n = builder(ctx, CH_DONE)
            .setSmallIcon(R.drawable.ic_stat_grove)
            .setContentTitle(isBreak ? "Break is over" : "Focus session complete")
            .setContentText(isBreak ? "Ready for the next round?" : "Open Study Grove to see your new tree.")
            .setContentIntent(openApp(ctx))
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setDefaults(Notification.DEFAULT_ALL)
            .build();
        nm.notify(ID_DONE, n);
    }

    static void dismissDone(Context ctx) {
        ctx.getSystemService(NotificationManager.class).cancel(ID_DONE);
    }

    private static void scheduleAlarm(Context ctx, long at) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        PendingIntent pi = broadcast(ctx, ACTION_DONE);
        // Exact needs "Alarms & reminders" allowed (Android 12+); otherwise Android may run it a little late.
        if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } else {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    private static void cancelAlarm(Context ctx) {
        ctx.getSystemService(AlarmManager.class).cancel(broadcast(ctx, ACTION_DONE));
    }

    private static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel live = new NotificationChannel(CH_LIVE, "Focus timer", NotificationManager.IMPORTANCE_LOW);
        live.setDescription("The running focus or break countdown.");
        live.setShowBadge(false);
        live.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationChannel done = new NotificationChannel(CH_DONE, "Session finished", NotificationManager.IMPORTANCE_HIGH);
        done.setDescription("Tells you when a focus session or break ends.");
        nm.createNotificationChannel(live);
        nm.createNotificationChannel(done);
    }

    @SuppressWarnings("deprecation")
    private static Notification.Builder builder(Context ctx, String channel) {
        return Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, channel) : new Notification.Builder(ctx);
    }

    private static Notification.Action action(Context ctx, String action, String label) {
        return new Notification.Action.Builder(Icon.createWithResource(ctx, R.drawable.ic_stat_grove), label, broadcast(ctx, action)).build();
    }

    // Explicit, immutable intents to our own unexported receiver: no other app can fire or alter them.
    private static PendingIntent broadcast(Context ctx, String action) {
        Intent i = new Intent(ctx, FocusReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(ctx, action.hashCode(), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent openApp(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static String clock(long ms) {
        long total = (ms + 999) / 1000;
        return String.format(Locale.US, "%02d:%02d", total / 60, total % 60);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
