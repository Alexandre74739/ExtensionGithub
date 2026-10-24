// Raccourcis GitHub :
// - Ctrl+P (Cmd+P sur macOS) : ouvre le profil de l'utilisateur connecté au lieu de lancer l'impression.
// - Ctrl+/ sur son propre profil : ouvre la recherche limitée à ses dépôts ("owner:<login> ").
//   La fin du nom du premier dépôt correspondant s'affiche en gris ; Tab+A l'accepte,
//   puis Entrée ouvre directement ce dépôt.

function getLogin() {
  // GitHub expose le login de l'utilisateur connecté dans une balise meta.
  const meta = document.querySelector('meta[name="user-login"]');
  return meta && meta.content ? meta.content : null;
}

function isOwnProfile(login) {
  const path = location.pathname.replace(/\/+$/, "").toLowerCase();
  return path === `/${login.toLowerCase()}`;
}

// --- Liste des dépôts -------------------------------------------------------

// Dans Firefox, `content.fetch` envoie la requête comme la page (avec la session GitHub).
const pageFetch =
  typeof content !== "undefined" && content && content.fetch
    ? content.fetch.bind(content)
    : fetch;

let repoNames = [];
let reposPromise = null;

async function fetchRepoNames(login) {
  // L'onglet "Repositories" du profil liste aussi les dépôts privés quand on est connecté.
  const names = [];
  for (let page = 1; page <= 20; page++) {
    const res = await pageFetch(
      `https://github.com/${encodeURIComponent(login)}?tab=repositories&page=${page}`,
      { credentials: "include" }
    );
    if (!res.ok) break;
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const found = [...doc.querySelectorAll('#user-repositories-list a[itemprop~="codeRepository"]')]
      .map((a) => (a.getAttribute("href") || "").split("/")[2])
      .filter((name) => name && !names.includes(name));
    if (found.length === 0) break;
    names.push(...found);
  }

  // Secours si GitHub change sa page : l'API publique (dépôts publics uniquement).
  if (names.length === 0) {
    const res = await pageFetch(
      `https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed`
    );
    if (res.ok) names.push(...(await res.json()).map((repo) => repo.name));
  }
  return names;
}

function loadRepos(login) {
  if (!reposPromise) {
    reposPromise = fetchRepoNames(login)
      .then((names) => {
        repoNames = names;
        updateGhost(document.activeElement);
        return names;
      })
      .catch(() => {
        reposPromise = null; // on réessaiera au prochain Ctrl+/
        return [];
      });
  }
  return reposPromise;
}

// --- Barre de recherche GitHub -----------------------------------------------

// GitHub change régulièrement le balisage de sa recherche : on accepte tout champ texte,
// le préfixe "owner:<login> " (voir getTerm) suffit à reconnaître la recherche de dépôts.
function isSearchInput(el) {
  return el instanceof HTMLInputElement && (el.type === "text" || el.type === "search");
}

// À l'ouverture, GitHub place le focus dans le champ de recherche.
function findOpenSearchInput() {
  const el = document.activeElement;
  return isSearchInput(el) && el.getClientRects().length > 0 ? el : null;
}

function findSearchButton() {
  return document.querySelector(
    [
      'button[aria-label*="to search" i]',
      'button[aria-haspopup="dialog"][aria-label^="Search" i]',
      'qbsearch-input [data-target="qbsearch-input.inputButton"]',
      ".header-search-button",
    ].join(", ")
  );
}

function waitFor(check, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function poll() {
      const result = check();
      if (result || Date.now() - start > timeoutMs) resolve(result);
      else setTimeout(poll, 50);
    })();
  });
}

function setInputValue(input, value) {
  // Passe par le setter natif pour que GitHub voie bien le changement.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  input.setSelectionRange(value.length, value.length);
}

async function openRepoSearch(login) {
  loadRepos(login);
  const button = findSearchButton();
  if (button) button.click();
  else document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  const input = await waitFor(findOpenSearchInput);
  if (input) setInputValue(input, `owner:${login} `);
}

// Texte tapé après "owner:<login> ", ou null si la recherche ne vise pas ses dépôts.
function getTerm(value, login) {
  const prefix = `owner:${login}`;
  if (!value.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const rest = value.slice(prefix.length);
  if (!/^\s/.test(rest)) return null;
  const term = rest.replace(/^\s+/, "");
  return /\s/.test(term) ? null : term;
}

function getSuggestion(input, login) {
  const term = getTerm(input.value, login);
  if (!term) return null;
  const name = repoNames.find(
    (repo) => repo.length > term.length && repo.toLowerCase().startsWith(term.toLowerCase())
  );
  return name ? { term, name } : null;
}

function getExactRepo(input, login) {
  const term = getTerm(input.value, login);
  if (!term) return null;
  return repoNames.find((repo) => repo.toLowerCase() === term.toLowerCase()) || null;
}

function acceptSuggestion(input, { term, name }) {
  setInputValue(input, input.value.slice(0, input.value.length - term.length) + name);
  updateGhost(input);
}

// --- Texte fantôme (fin du nom en gris) ---------------------------------------

const ghost = document.createElement("span");
ghost.style.cssText =
  "position:fixed;pointer-events:none;z-index:2147483647;white-space:pre;color:#8b949e;display:none;";
const measureCtx = document.createElement("canvas").getContext("2d");

function inputFont(input) {
  const s = getComputedStyle(input);
  return `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
}

function hideGhost() {
  ghost.style.display = "none";
}

function updateGhost(input) {
  const login = getLogin();
  const suggestion = login && isSearchInput(input) ? getSuggestion(input, login) : null;
  if (!suggestion || input.selectionStart !== input.value.length) return hideGhost();

  // Dans le même conteneur que la recherche, pour rester au-dessus de la fenêtre modale.
  const host = input.closest("dialog") || document.body;
  if (ghost.parentNode !== host) host.appendChild(ghost);

  const s = getComputedStyle(input);
  const rect = input.getBoundingClientRect();
  measureCtx.font = inputFont(input);
  const left =
    rect.left +
    parseFloat(s.borderLeftWidth) +
    parseFloat(s.paddingLeft) +
    measureCtx.measureText(input.value).width -
    input.scrollLeft;

  ghost.textContent = suggestion.name.slice(suggestion.term.length);
  ghost.style.font = inputFont(input);
  ghost.style.lineHeight = `${rect.height}px`;
  ghost.style.display = "block";
  ghost.style.left = `${left}px`;
  ghost.style.top = `${rect.top}px`;

  // Corrige le décalage si un parent transformé change le repère de position: fixed.
  const actual = ghost.getBoundingClientRect();
  ghost.style.left = `${2 * left - actual.left}px`;
  ghost.style.top = `${2 * rect.top - actual.top}px`;
}

for (const type of ["input", "keyup", "click", "focusin"]) {
  document.addEventListener(type, (event) => updateGhost(event.target), true);
}
document.addEventListener("focusout", hideGhost, true);

// --- Raccourcis clavier -------------------------------------------------------

let tabHeld = false;

window.addEventListener("keyup", (event) => {
  if (event.key === "Tab") tabHeld = false;
}, true);
window.addEventListener("blur", () => {
  tabHeld = false;
});

window.addEventListener(
  "keydown",
  (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const login = getLogin();

    // Ctrl+P : profil.
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "p") {
      // Bloque l'impression du navigateur et les raccourcis de GitHub.
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.href = login
        ? `https://github.com/${encodeURIComponent(login)}`
        : "https://github.com/login";
      return;
    }

    if (!login) return;

    // Ctrl+/ sur son profil : recherche dans ses dépôts.
    // (En AZERTY, "/" se tape avec Maj, donc on n'exclut pas shiftKey.)
    if (mod && !event.altKey && (event.key === "/" || event.code === "NumpadDivide")) {
      if (!isOwnProfile(login)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openRepoSearch(login);
      return;
    }

    const input = event.target;
    if (!isSearchInput(input)) return;

    // Tab maintenu : on garde le focus dans la recherche pour attendre le A.
    if (event.key === "Tab" && !mod && !event.altKey && !event.shiftKey) {
      if (!getSuggestion(input, login)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      tabHeld = true;
      return;
    }

    // Tab+A : accepte la suggestion.
    if (tabHeld && !mod && !event.altKey && event.key.toLowerCase() === "a") {
      const suggestion = getSuggestion(input, login);
      if (!suggestion) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      acceptSuggestion(input, suggestion);
      return;
    }

    // Entrée sur un nom de dépôt complet : ouvre le dépôt au lieu de lancer une recherche.
    if (event.key === "Enter" && !mod && !event.altKey && !event.shiftKey) {
      const repo = getExactRepo(input, login);
      if (!repo) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.href = `https://github.com/${encodeURIComponent(login)}/${encodeURIComponent(repo)}`;
    }
  },
  true // phase de capture : on passe avant les gestionnaires de GitHub
);
