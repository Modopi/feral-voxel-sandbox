package com.kgb.feral.migration;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;

import org.godotengine.godot.Godot;
import org.godotengine.godot.plugin.GodotPlugin;
import org.godotengine.godot.plugin.SignalInfo;
import org.godotengine.godot.plugin.UsedByGodot;

import java.io.File;
import java.util.HashSet;
import java.util.Set;

/** One-shot read-only bridge for the WebView data owned by app version 0.3.3. */
public final class FeralMigrationPlugin extends GodotPlugin {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LegacyWebViewExporter exporter;
    private boolean active;

    public FeralMigrationPlugin(Godot godot) {
        super(godot);
    }

    @Override
    public String getPluginName() {
        return "FeralMigration";
    }

    @Override
    public Set<SignalInfo> getPluginSignals() {
        Set<SignalInfo> signals = new HashSet<>();
        signals.add(new SignalInfo("completed", String.class, String.class));
        return signals;
    }

    /** Start exporting old WebView data. The signal is emitted only after the complete JSON file is synced. */
    @UsedByGodot
    public void start_import() {
        runOnHostThread(() -> {
            if (active) return;
            Activity activity = getActivity();
            if (activity == null) {
                emitSignal("completed", "", "activity_unavailable");
                return;
            }
            active = true;
            File output = new File(activity.getFilesDir(), "feral-native-migration");
            exporter = new LegacyWebViewExporter(activity, output, (path, error) -> {
                active = false;
                exporter = null;
                emitSignal("completed", path == null ? "" : path, error == null ? "" : error);
            });
            exporter.start();
        });
    }

    @Override
    public void onMainDestroy() {
        handler.post(() -> {
            if (exporter != null) exporter.cancel();
            exporter = null;
            active = false;
        });
        super.onMainDestroy();
    }
}
