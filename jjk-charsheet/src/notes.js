let _getState = null;
let _scheduleSave = null;
let _initialized = false;

function getState() {
  return _getState ? _getState() : null;
}

function scheduleSave() {
  if (_scheduleSave) _scheduleSave();
}

function ensureNotesState(state) {
  if (!state || typeof state !== "object") return;
  if (!Array.isArray(state.notes)) state.notes = [];

  state.notes = state.notes.map((entry, index) => {
    const raw = entry && typeof entry === "object" ? entry : {};
    const id = String(raw.id || `note-${Date.now()}-${index}`);
    return {
      id,
      title: String(raw.title || "Untitled Note"),
      content: String(raw.content || ""),
      collapsed: Boolean(raw.collapsed),
    };
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderNotes(state) {
  const list = document.getElementById("notesList");
  if (!list) return;

  ensureNotesState(state);
  const notes = state.notes;

  if (!notes.length) {
    list.innerHTML = '<div class="notes-empty">No notes yet. Click New Note to start writing.</div>';
    return;
  }

  list.innerHTML = notes.map(note => {
    const caret = note.collapsed ? "&#9658;" : "&#9662;";
    const contentHidden = note.collapsed ? " hidden" : "";
    return `
      <article class="notes-item" data-note-id="${escapeHtml(note.id)}">
        <div class="notes-item-head">
          <button type="button" class="notes-toggle-btn" data-note-toggle="${escapeHtml(note.id)}" aria-label="Toggle note">${caret}</button>
          <input class="meta-input notes-title-input" data-note-title="${escapeHtml(note.id)}" value="${escapeHtml(note.title)}" placeholder="Untitled Note" />
          <button type="button" class="notes-delete-btn" data-note-delete="${escapeHtml(note.id)}" aria-label="Delete note" title="Delete">&times;</button>
        </div>
        <textarea class="inventory-textarea notes-content" data-note-content="${escapeHtml(note.id)}" rows="5" maxlength="3000" placeholder="Write your note here..."${contentHidden}>${escapeHtml(note.content)}</textarea>
      </article>
    `;
  }).join("");
}

function findNoteIndexById(state, noteId) {
  ensureNotesState(state);
  return state.notes.findIndex(note => note.id === noteId);
}

function createNewNote() {
  const state = getState();
  if (!state) return;
  ensureNotesState(state);

  state.notes.unshift({
    id: `note-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    title: "Untitled Note",
    content: "",
    collapsed: false,
  });

  renderNotes(state);
  scheduleSave();
}

export function applyNotesStateToUI() {
  const state = getState();
  if (!state) return;
  renderNotes(state);
}

export function initNotes({ getState: getStateFn, scheduleSave: scheduleSaveFn }) {
  _getState = getStateFn;
  _scheduleSave = scheduleSaveFn;

  if (_initialized) {
    applyNotesStateToUI();
    return;
  }

  const addBtn = document.getElementById("addNoteBtn");
  const list = document.getElementById("notesList");

  if (addBtn) {
    addBtn.addEventListener("click", () => {
      createNewNote();
    });
  }

  if (list) {
    list.addEventListener("click", e => {
      const state = getState();
      if (!state) return;

      const toggleBtn = e.target?.closest?.("[data-note-toggle]");
      if (toggleBtn) {
        const noteId = String(toggleBtn.dataset.noteToggle || "");
        const idx = findNoteIndexById(state, noteId);
        if (idx >= 0) {
          state.notes[idx].collapsed = !Boolean(state.notes[idx].collapsed);
          renderNotes(state);
          scheduleSave();
        }
        return;
      }

      const deleteBtn = e.target?.closest?.("[data-note-delete]");
      if (deleteBtn) {
        const noteId = String(deleteBtn.dataset.noteDelete || "");
        const idx = findNoteIndexById(state, noteId);
        if (idx >= 0) {
          state.notes.splice(idx, 1);
          renderNotes(state);
          scheduleSave();
        }
      }
    });

    list.addEventListener("input", e => {
      const state = getState();
      if (!state) return;

      const titleField = e.target?.dataset?.noteTitle;
      if (titleField !== undefined) {
        const idx = findNoteIndexById(state, String(titleField));
        if (idx >= 0) {
          const value = String(e.target.value || "").trim();
          state.notes[idx].title = value || "Untitled Note";
          scheduleSave();
        }
        return;
      }

      const contentField = e.target?.dataset?.noteContent;
      if (contentField !== undefined) {
        const idx = findNoteIndexById(state, String(contentField));
        if (idx >= 0) {
          state.notes[idx].content = String(e.target.value || "");
          scheduleSave();
        }
      }
    });
  }

  _initialized = true;
  applyNotesStateToUI();
}
