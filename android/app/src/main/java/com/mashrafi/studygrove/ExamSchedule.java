package com.mashrafi.studygrove;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * When an exam's calendar reminders happen. Pure date maths, so it is unit tested.
 * Every day at 12:00 up to the day before the exam, every day at 20:00 up to two days before,
 * and a separate "exam tomorrow" reminder at 20:00 the night before.
 */
final class ExamSchedule {

    static final int NOON = 12;
    static final int EVENING = 20;

    /** A daily repeating reminder from first to last (inclusive), both at the same local time. */
    static final class Series {
        final long first;
        final long last;

        Series(long first, long last) {
            this.first = first;
            this.last = last;
        }

        int count() {
            return (int) Math.round((last - first) / 86_400_000d) + 1; // DST shifts are under an hour
        }
    }

    Series noon;
    Series evening;
    long nightBefore = -1; // -1 when the night before has already passed
    long examDayUtc; // midnight UTC of the exam date, as all-day calendar events require

    private ExamSchedule() {}

    static ExamSchedule plan(int year, int month1, int day, long now, TimeZone tz) {
        ExamSchedule p = new ExamSchedule();
        Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        utc.clear();
        utc.set(year, month1 - 1, day);
        p.examDayUtc = utc.getTimeInMillis();
        p.noon = series(year, month1, day, NOON, 1, now, tz);
        p.evening = series(year, month1, day, EVENING, 2, now, tz);
        long nb = at(year, month1, day, -1, EVENING, tz);
        p.nightBefore = nb > now ? nb : -1;
        return p;
    }

    private static Series series(int y, int m, int d, int hour, int stopDaysBefore, long now, TimeZone tz) {
        Calendar first = Calendar.getInstance(tz);
        first.setTimeInMillis(now);
        first.set(Calendar.HOUR_OF_DAY, hour);
        first.set(Calendar.MINUTE, 0);
        first.set(Calendar.SECOND, 0);
        first.set(Calendar.MILLISECOND, 0);
        if (first.getTimeInMillis() <= now) first.add(Calendar.DAY_OF_MONTH, 1);
        long last = at(y, m, d, -stopDaysBefore, hour, tz);
        return first.getTimeInMillis() <= last ? new Series(first.getTimeInMillis(), last) : null;
    }

    private static long at(int y, int m, int d, int dayOffset, int hour, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz);
        c.clear();
        c.set(y, m - 1, d, hour, 0, 0);
        c.add(Calendar.DAY_OF_MONTH, dayOffset);
        return c.getTimeInMillis();
    }
}
