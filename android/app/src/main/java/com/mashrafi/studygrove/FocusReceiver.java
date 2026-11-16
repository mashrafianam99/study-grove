package com.mashrafi.studygrove;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.util.Locale;

/** Notification buttons and the end-of-session alarm. Not exported: only our own PendingIntents reach it. */
public class FocusReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        switch (action) {
            case FocusLive.ACTION_DONE:
                FocusLive.announceDone(ctx);
                break;
            case FocusLive.ACTION_PAUSE:
            case FocusLive.ACTION_RESUME:
            case FocusLive.ACTION_STOP:
                // Update the notification right away (works even when the app is closed),
                // then let the app follow along if it is running.
                FocusLive.apply(ctx, action);
                FocusLivePlugin.forward(action.substring(action.lastIndexOf('.') + 1).toLowerCase(Locale.US));
                break;
            default:
                break;
        }
    }
}
