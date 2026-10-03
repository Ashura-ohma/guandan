package io.neonguandan.game;

/** Exact allowlist for local page navigation and the two native orientation actions. */
final class NavigationPolicy {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String HOME = ORIGIN + "/assets/www/index.html";
    enum Action { HOME, LANDSCAPE, AUTO, BLOCKED }

    private NavigationPolicy() { }

    static Action route(String url, String currentUrl, boolean mainFrame, String method) {
        if (!mainFrame || !"GET".equals(method)) return Action.BLOCKED;
        if (HOME.equals(url)) return Action.HOME;
        if (!HOME.equals(currentUrl)) return Action.BLOCKED;
        if ((ORIGIN + "/ui/landscape").equals(url)) return Action.LANDSCAPE;
        if ((ORIGIN + "/ui/auto").equals(url)) return Action.AUTO;
        return Action.BLOCKED;
    }
}
