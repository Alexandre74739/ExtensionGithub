// Ctrl+P (Cmd+P sur macOS) sur github.com : ouvre le profil de l'utilisateur connecté
// au lieu de lancer l'impression.

function getLogin() {
  // GitHub expose le login de l'utilisateur connecté dans une balise meta.
  const meta = document.querySelector('meta[name="user-login"]');
  return meta && meta.content ? meta.content : null;
}

window.addEventListener(
  "keydown",
  (event) => {
    const isCtrlP =
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "p";
    if (!isCtrlP) return;

    // Bloque l'impression du navigateur et les raccourcis de GitHub.
    event.preventDefault();
    event.stopImmediatePropagation();

    const login = getLogin();
    window.location.href = login
      ? `https://github.com/${encodeURIComponent(login)}`
      : "https://github.com/login";
  },
  true // phase de capture : on passe avant les gestionnaires de GitHub
);
