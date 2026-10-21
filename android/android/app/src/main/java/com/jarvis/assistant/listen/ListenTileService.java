package com.jarvis.assistant.listen;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

import androidx.annotation.RequiresApi;

import com.jarvis.assistant.MainActivity;

/**
 * v0.9 Stufe 0 – Schnelleinstellungs-Kachel „Jarvis fragen“: öffnet Jarvis und hört sofort zu.
 * Läuft nur, wenn du auf die Kachel tippst (kein Dauer-Dienst, kein Mikrofon im Hintergrund).
 */
@RequiresApi(api = Build.VERSION_CODES.N)
public class ListenTileService extends TileService {
    @Override
    public void onStartListening() {
        Tile t = getQsTile();
        if (t == null) return;
        t.setState(Tile.STATE_INACTIVE);
        t.setLabel("Jarvis fragen");
        t.updateTile();
    }

    @Override
    public void onClick() {
        Intent i = new Intent(this, MainActivity.class)
            .setAction(ListenLaunch.ACTION_LISTEN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (Build.VERSION.SDK_INT >= 34) {
            // Ab Android 14 nur noch mit PendingIntent erlaubt
            PendingIntent pi = PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            startActivityAndCollapse(pi);
        } else {
            startActivityAndCollapseLegacy(i);
        }
    }

    @SuppressWarnings("deprecation")
    private void startActivityAndCollapseLegacy(Intent i) {
        startActivityAndCollapse(i);
    }
}
