package io.neonguandan.game;

/** Byte-for-byte local resource allowlist, with no URI normalization or file access. */
final class ResourcePolicy {
    private static final String PREFIX = NavigationPolicy.ORIGIN + "/assets/www/";
    private static final String[] NAMES = {
        "index.html", "style.css", "game.js", "engine.js", "audio.js", "hand-layout.js"
    };

    private ResourcePolicy() { }

    static String assetName(String url, String method) {
        if (!"GET".equals(method)) return null;
        for (String name : NAMES) {
            if ((PREFIX + name).equals(url)) return name;
        }
        return null;
    }
}
