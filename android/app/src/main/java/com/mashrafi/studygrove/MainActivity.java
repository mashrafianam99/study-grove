package com.mashrafi.studygrove;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FocusLivePlugin.class);
        registerPlugin(ExamCalendarPlugin.class);
        super.onCreate(savedInstanceState);
        // Without @capacitor/app, Android's back simply closes the app. Ask the web app first
        // (close focus mode, or return to Today); only leave when it says it didn't handle it.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                bridge.getWebView().evaluateJavascript(
                    "!!(window.studyGroveBack && window.studyGroveBack())",
                    (handled) -> {
                        if (!"true".equals(handled)) moveTaskToBack(true);
                    }
                );
            }
        });
    }
}
