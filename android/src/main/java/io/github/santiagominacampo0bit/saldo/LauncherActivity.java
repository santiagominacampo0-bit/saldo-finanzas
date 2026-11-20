package io.github.santiagominacampo0bit.saldo;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.IBinder;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Opens the published Saldo app in a browser-owned, non-ephemeral session. */
public final class LauncherActivity extends Activity {
    private static final Uri SALDO_URL = Uri.parse(
            "https://santiagominacampo0-bit.github.io/saldo-finanzas/");
    private static final String SESSION = "android.support.customtabs.extra.SESSION";
    private static final String TOOLBAR_COLOR = "android.support.customtabs.extra.TOOLBAR_COLOR";
    private static final String TITLE_VISIBILITY = "android.support.customtabs.extra.TITLE_VISIBILITY";

    @Override
    protected void onCreate(Bundle instanceState) {
        super.onCreate(instanceState);
        openSaldo();
    }

    private void openSaldo() {
        Intent launch = new Intent(Intent.ACTION_VIEW, SALDO_URL);
        launch.addCategory(Intent.CATEGORY_BROWSABLE);

        // Custom Tabs use this marker without requiring a service connection or prewarming.
        Bundle browserExtras = new Bundle();
        browserExtras.putBinder(SESSION, (IBinder) null);
        launch.putExtras(browserExtras);
        launch.putExtra(TOOLBAR_COLOR, getColor(R.color.saldo_background));
        launch.putExtra(TITLE_VISIBILITY, 1);

        try {
            startActivity(launch);
            finish();
        } catch (ActivityNotFoundException missingBrowser) {
            showBrowserHelp();
        }
    }

    private void showBrowserHelp() {
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        LinearLayout help = new LinearLayout(this);
        help.setOrientation(LinearLayout.VERTICAL);
        help.setGravity(Gravity.CENTER);
        help.setPadding(padding, padding, padding, padding);

        TextView message = new TextView(this);
        message.setGravity(Gravity.CENTER);
        message.setText(R.string.browser_needed);
        help.addView(message);

        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(view -> openSaldo());
        help.addView(retry);
        setContentView(help);
    }
}
