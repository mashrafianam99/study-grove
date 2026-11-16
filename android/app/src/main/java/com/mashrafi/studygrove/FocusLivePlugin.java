package com.mashrafi.studygrove;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.os.Build;
import android.provider.AlarmClock;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** JS bridge for the live timer notification (see js/native.js). */
@CapacitorPlugin(name = "FocusLive", permissions = @Permission(alias = "notifications", strings = Manifest.permission.POST_NOTIFICATIONS))
public class FocusLivePlugin extends Plugin {

    private static volatile FocusLivePlugin active;

    @Override
    public void load() {
        active = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (active == this) active = null;
    }

    /** Lets the web app follow a notification button press while it is running. */
    static void forward(String action) {
        FocusLivePlugin p = active;
        if (p == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        p.notifyListeners("action", data);
    }

    @PluginMethod
    public void update(PluginCall call) {
        // The web view is the trust boundary: accept only a well-formed timer state.
        String status = call.getString("status", "");
        String kind = call.getString("kind", "");
        // optDouble, not call.getDouble: Capacitor's getDouble ignores Long values, and an epoch
        // timestamp arrives as a Long, which made every running timer look invalid.
        double endAt = call.getData().optDouble("endAt", -1d);
        double remaining = call.getData().optDouble("remainingMs", -1d);
        double total = call.getData().optDouble("totalMs", -1d);
        String title = call.getString("title", "Focus");
        long now = System.currentTimeMillis();
        boolean ok = (status.equals("idle") || status.equals("running") || status.equals("paused"))
            && (kind.equals("focus") || kind.equals("break"))
            && Double.isFinite(endAt) && Double.isFinite(remaining) && Double.isFinite(total)
            && total >= 0 && total <= FocusLive.MAX_SESSION_MS
            && remaining >= 0 && remaining <= total
            && (!status.equals("running") || (endAt > now - 60_000 && endAt <= now + FocusLive.MAX_SESSION_MS));
        if (!ok) {
            call.reject("Invalid timer state");
            return;
        }
        boolean onScreen = getActivity() != null && getActivity().hasWindowFocus();
        FocusLive.State prev = FocusLive.load(getContext());
        // The app finished the session in the background before the alarm fired: still announce it.
        if (status.equals("idle") && !onScreen && "running".equals(prev.status) && prev.endAt <= now + 1000) {
            FocusLive.announceDone(getContext());
        }
        FocusLive.State s = new FocusLive.State();
        s.status = status;
        s.kind = kind;
        s.endAt = (long) endAt;
        s.remainingMs = (long) remaining;
        s.totalMs = (long) total;
        s.title = title.length() > 60 ? title.substring(0, 60) : title;
        s.updatedAt = now;
        FocusLive.save(getContext(), s);
        FocusLive.render(getContext(), s);
        // The app finished the session itself while on screen: the "complete" notice isn't needed too.
        if (status.equals("idle") && onScreen) FocusLive.dismissDone(getContext());
        call.resolve();
    }

    /**
     * Starts a timer in the phone's own Clock app. The Clock is a system app, so its timer gets the
     * Super Island on HyperOS, the status bar, the lock screen and its own alarm, on any phone.
     * Resolves { started: false } when no Clock app accepts the request.
     */
    @PluginMethod
    public void startClockTimer(PluginCall call) {
        int seconds = call.getData().optInt("seconds", -1);
        String message = call.getString("message", "Study Grove");
        if (seconds < 1 || seconds > FocusLive.MAX_SESSION_MS / 1000) {
            call.reject("Invalid timer length");
            return;
        }
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            .putExtra(AlarmClock.EXTRA_MESSAGE, message.length() > 60 ? message.substring(0, 60) : message)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true); // start it without leaving Study Grove, where the Clock allows
        resolveStarted(call, launch(i));
    }

    /**
     * Asks the Clock app to dismiss its timer. Xiaomi's Clock (and others) don't accept that, so it
     * then opens the Clock's timer screen for a one-tap pause/cancel. Resolves { dismissed, opened }.
     */
    @PluginMethod
    public void dismissClockTimer(PluginCall call) {
        boolean dismissed = launch(new Intent(AlarmClock.ACTION_DISMISS_TIMER).putExtra(AlarmClock.EXTRA_SKIP_UI, true));
        boolean opened = !dismissed && launch(new Intent(AlarmClock.ACTION_SHOW_TIMERS));
        JSObject r = new JSObject();
        r.put("dismissed", dismissed);
        r.put("opened", opened);
        call.resolve(r);
    }

    private boolean launch(Intent i) {
        if (getActivity() == null) return false;
        try {
            getActivity().startActivity(i);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            Logger.warn("FocusLive", "Clock app did not accept " + i.getAction() + ": " + e.getMessage());
            return false;
        }
    }

    private static void resolveStarted(PluginCall call, boolean started) {
        JSObject r = new JSObject();
        r.put("started", started);
        call.resolve(r);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        FocusLive.State s = FocusLive.load(getContext());
        JSObject r = new JSObject();
        r.put("status", s.status);
        r.put("kind", s.kind);
        r.put("endAt", s.endAt);
        r.put("remainingMs", s.remainingMs);
        r.put("totalMs", s.totalMs);
        r.put("updatedAt", s.updatedAt);
        r.put("endedEarlyMs", s.endedEarlyMs);
        call.resolve(r);
    }

    // Android 12 and older have no notification permission: notifications are simply allowed.
    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33) {
            JSObject r = new JSObject();
            r.put("notifications", "granted");
            call.resolve(r);
        } else {
            super.checkPermissions(call);
        }
    }

    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) checkPermissions(call);
        else requestPermissionForAlias("notifications", call, "permsDone");
    }

    @PermissionCallback
    private void permsDone(PluginCall call) {
        checkPermissions(call);
    }
}
