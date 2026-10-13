// Bottom-Sheet mit Wischgeste zum Schließen.

const sheet = () => document.getElementById('sheet');
const body = () => document.getElementById('sheet-body');
const backdrop = () => document.getElementById('sheet-backdrop');

let onCloseCb = null;
let openToken = 0;

export function isOpen() {
  return sheet().classList.contains('is-open');
}

/**
 * Öffnet das Sheet. `content` ist HTML oder ein Element.
 * @returns {HTMLElement} der Inhaltscontainer
 */
export function openSheet(content, { onClose } = {}) {
  const s = sheet();
  const b = body();
  const prevClose = onCloseCb;
  onCloseCb = null;
  if (isOpen()) prevClose?.({ replaced: true });
  onCloseCb = onClose || null;
  openToken++;
  if (typeof content === 'string') b.innerHTML = content;
  else b.replaceChildren(content);
  b.scrollTop = 0;
  s.style.removeProperty('--drag');
  backdrop().hidden = false;
  requestAnimationFrame(() => {
    backdrop().classList.add('is-open');
    s.classList.add('is-open');
    s.setAttribute('aria-hidden', 'false');
  });
  if (!history.state?.sheet) history.pushState({ sheet: true }, '');
  return b;
}

export function closeSheet({ fromHistory = false } = {}) {
  if (!isOpen()) return;
  const s = sheet();
  s.classList.remove('is-open');
  s.setAttribute('aria-hidden', 'true');
  backdrop().classList.remove('is-open');
  const token = ++openToken;
  setTimeout(() => {
    if (token === openToken) {
      backdrop().hidden = true;
      body().replaceChildren();
    }
  }, 380);
  const cb = onCloseCb;
  onCloseCb = null;
  cb?.({ replaced: false });
  if (!fromHistory && history.state?.sheet) history.back();
}

export function sheetBody() {
  return body();
}

export function initSheet() {
  backdrop().addEventListener('click', () => closeSheet());
  window.addEventListener('popstate', () => {
    if (isOpen()) closeSheet({ fromHistory: true });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closeSheet();
  });

  // Ziehen am Griff oder (wenn ganz oben gescrollt) am Inhalt
  let startY = 0;
  let dy = 0;
  let dragging = false;
  const s = sheet();
  const start = (e) => {
    const target = e.target;
    const onHandle = target.closest('#sheet-handle');
    if (!onHandle && (body().scrollTop > 0 || target.closest('input, select, textarea, .chip-row, .alt-list, .holo-card'))) return;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    dy = 0;
    dragging = true;
  };
  const move = (e) => {
    if (!dragging) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    dy = Math.max(0, y - startY);
    if (dy > 4) {
      s.classList.add('is-dragging');
      s.style.setProperty('--drag', `${dy}px`);
      if (e.cancelable) e.preventDefault();
    }
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    s.classList.remove('is-dragging');
    if (dy > 110) closeSheet();
    else s.style.removeProperty('--drag');
  };
  s.addEventListener('touchstart', start, { passive: true });
  s.addEventListener('touchmove', move, { passive: false });
  s.addEventListener('touchend', end);
  document.getElementById('sheet-handle').addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    start(e);
    const mv = (ev) => move(ev);
    const up = () => {
      end();
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  });
}
