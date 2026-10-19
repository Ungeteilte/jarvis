package com.jarvis.assistant.updater;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Tags wie „v0.3-android“ / „v1.2.3-android“ lesen und vergleichen. */
public final class UpdateVersion implements Comparable<UpdateVersion> {
    private static final Pattern TAG = Pattern.compile("^v(\\d{1,4})\\.(\\d{1,4})(?:\\.(\\d{1,4}))?-android$");

    public final int major, minor, patch;

    public UpdateVersion(int major, int minor, int patch) {
        this.major = major; this.minor = minor; this.patch = patch;
    }

    /** null, wenn das Tag nicht dem Schema vX.Y[.Z]-android entspricht. */
    public static UpdateVersion parseTag(String tag) {
        if (tag == null) return null;
        Matcher m = TAG.matcher(tag.trim());
        if (!m.matches()) return null;
        return new UpdateVersion(
            Integer.parseInt(m.group(1)),
            Integer.parseInt(m.group(2)),
            m.group(3) == null ? 0 : Integer.parseInt(m.group(3)));
    }

    /** versionName „0.3“ / „0.3.1“ (ohne v, ohne -android). */
    public static UpdateVersion parseName(String name) {
        if (name == null) return null;
        String n = name.trim();
        if (n.startsWith("v")) n = n.substring(1);
        return parseTag("v" + n + (n.endsWith("-android") ? "" : "-android"));
    }

    @Override
    public int compareTo(UpdateVersion o) {
        if (major != o.major) return Integer.compare(major, o.major);
        if (minor != o.minor) return Integer.compare(minor, o.minor);
        return Integer.compare(patch, o.patch);
    }

    /** Maßgeblich ist versionCode (falls bekannt), sonst die Tag-Version. */
    public static boolean isNewer(long remoteCode, long localCode) {
        return remoteCode > 0 && remoteCode > localCode;
    }

    @Override
    public String toString() {
        return patch == 0 ? major + "." + minor : major + "." + minor + "." + patch;
    }

    @Override public boolean equals(Object o) {
        return o instanceof UpdateVersion && compareTo((UpdateVersion) o) == 0;
    }
    @Override public int hashCode() { return (major * 10007 + minor) * 10007 + patch; }
}
