package com.mashrafi.studygrove;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Calendar;
import java.util.TimeZone;
import org.junit.Test;

public class ExamScheduleTest {

    private static final TimeZone DHAKA = TimeZone.getTimeZone("Asia/Dhaka");

    private static long local(int y, int m, int d, int h) {
        Calendar c = Calendar.getInstance(DHAKA);
        c.clear();
        c.set(y, m - 1, d, h, 0);
        return c.getTimeInMillis();
    }

    @Test
    public void examInThreeDaysAddedInTheMorningGetsEveryReminder() {
        ExamSchedule p = ExamSchedule.plan(2026, 12, 4, local(2026, 12, 1, 10), DHAKA);
        assertEquals(local(2026, 12, 1, 12), p.noon.first);
        assertEquals(local(2026, 12, 3, 12), p.noon.last);
        assertEquals(3, p.noon.count());
        assertEquals(local(2026, 12, 1, 20), p.evening.first);
        assertEquals(local(2026, 12, 2, 20), p.evening.last);
        assertEquals(2, p.evening.count()); // repeat count used in the calendar RRULE
        assertEquals(local(2026, 12, 3, 20), p.nightBefore);
    }

    @Test
    public void addedAfterNoonStartsNoonRemindersTomorrow() {
        ExamSchedule p = ExamSchedule.plan(2026, 12, 4, local(2026, 12, 1, 12), DHAKA);
        assertEquals(local(2026, 12, 2, 12), p.noon.first);
        assertEquals(2, p.noon.count());
    }

    @Test
    public void examTomorrowOnlyKeepsWhatIsStillAhead() {
        ExamSchedule p = ExamSchedule.plan(2026, 12, 2, local(2026, 12, 1, 9), DHAKA);
        assertEquals(1, p.noon.count());
        assertNull(p.evening);
        assertEquals(local(2026, 12, 1, 20), p.nightBefore);
    }

    @Test
    public void examTodayHasNoReminders() {
        ExamSchedule p = ExamSchedule.plan(2026, 12, 1, local(2026, 12, 1, 8), DHAKA);
        assertNull(p.noon);
        assertNull(p.evening);
        assertEquals(-1, p.nightBefore);
    }

    @Test
    public void allDayExamStartsAtUtcMidnight() {
        ExamSchedule p = ExamSchedule.plan(2026, 12, 4, local(2026, 12, 1, 8), DHAKA);
        assertEquals(0, p.examDayUtc % 86_400_000L);
    }
}
