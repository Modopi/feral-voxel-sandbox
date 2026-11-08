package com.kgb.feral.migration;

import androidx.core.content.FileProvider;

/** Separate provider identity so the update cache can coexist with Godot's own FileProvider. */
public final class FeralUpdatesFileProvider extends FileProvider {
}
