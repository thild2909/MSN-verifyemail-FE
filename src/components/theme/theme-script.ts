/** localStorage key holding "light" | "dark" | "system". */
export const THEME_STORAGE_KEY = "theme";

/**
 * Runs inline in <head> before hydration: resolves the saved preference (or the
 * OS setting for "system") and sets the `dark` class so the first paint is right.
 * Kept out of the "use client" provider module so the server layout can import
 * the plain string.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark')t='system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
