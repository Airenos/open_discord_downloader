// This script runs in the main world of the web page, allowing access to the original page's globals and webpack
setTimeout(() => {
    const extractToken = () => {
        const cleanToken = (t) => t ? t.replace(/^"|"$/g, "") : null;

        // Method 1: Try finding it via Webpack (more robust)
        try {
            if (window.webpackChunkdiscord_app) {
                let token = null;
                window.webpackChunkdiscord_app.push([
                    [Symbol()],
                    {},
                    (require) => {
                        for (const key in require.c) {
                            const module = require.c[key].exports;
                            if (module) {
                                if (module.default && typeof module.default.getToken === 'function') {
                                    token = module.default.getToken();
                                    if (token) break;
                                }
                                if (typeof module.getToken === 'function') {
                                    token = module.getToken();
                                    if (token) break;
                                }
                            }
                        }
                    }
                ]);
                window.webpackChunkdiscord_app.pop(); // Clean up
                if (token) return cleanToken(token);
            }
        } catch (err) {
            console.error("[Discord Downloader] Webpack extraction failed", err);
        }

        // Method 2: Try localStorage fallback
        try {
            const token = localStorage.getItem("token");
            if (token) return cleanToken(token);
        } catch (err) {
            console.error("[Discord Downloader] LocalStorage extraction failed", err);
        }

        return null;
    };

    const token = extractToken();
    const result = token ? { token, success: true } : { error: "No token found", success: false };
    
    // Send back to content.js
    window.postMessage({ type: "DISCORD_TOKEN_RESULT", data: result }, "*");
}, 1000); // Slight delay to ensure page and webpack are fully loaded
