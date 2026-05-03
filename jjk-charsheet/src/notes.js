let _getState = null;
let _scheduleSave = null;
let _initialized = false;
let _newlyAddedNoteId = null;

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
    const isNew = note.id === _newlyAddedNoteId ? " notes-item--new" : "";
    const collapsedClass = note.collapsed ? " notes-content-wrap--collapsed" : "";
    const toggleCollapsedClass = note.collapsed ? " is-collapsed" : "";
    return `
      <article class="notes-item${isNew}" data-note-id="${escapeHtml(note.id)}">
        <div class="notes-item-head">
          <button type="button" class="notes-toggle-btn${toggleCollapsedClass}" data-note-toggle="${escapeHtml(note.id)}" aria-label="Toggle note">
            <svg class="notes-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M7 10.5 12 15.5 17 10.5l-1.4-1.4-3.6 3.6-3.6-3.6z"/>
            </svg>
          </button>
          <input class="meta-input notes-title-input" data-note-title="${escapeHtml(note.id)}" value="${escapeHtml(note.title)}" placeholder="Untitled Note" />
          <button type="button" class="notes-delete-btn" data-note-delete="${escapeHtml(note.id)}" aria-label="Delete note" title="Delete">
            <svg class="notes-delete-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M6.7 5.3L5.3 6.7 10.6 12l-5.3 5.3 1.4 1.4 5.3-5.3 5.3 5.3 1.4-1.4-5.3-5.3 5.3-5.3-1.4-1.4-5.3 5.3-5.3-5.3z"/>
            </svg>
          </button>
        </div>
        <div class="notes-content-wrap${collapsedClass}" data-note-content-wrap="${escapeHtml(note.id)}">
          <textarea class="inventory-textarea notes-content" data-note-content="${escapeHtml(note.id)}" rows="5" maxlength="3000" placeholder="Write your note here...">${escapeHtml(note.content)}</textarea>
        </div>
      </article>
    `;
  }).join("");

  if (_newlyAddedNoteId) {
    const newEntry = list.querySelector(`[data-note-id="${_newlyAddedNoteId}"]`);
    if (newEntry) {
      requestAnimationFrame(() => {
        newEntry.classList.add("notes-item--new-active");
      });
    }
    _newlyAddedNoteId = null;
  }
}

function findNoteIndexById(state, noteId) {
  ensureNotesState(state);
  return state.notes.findIndex(note => note.id === noteId);
}

function createNewNote() {
  const state = getState();
  if (!state) return;
  ensureNotesState(state);

  const newId = `note-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  state.notes.unshift({
    id: newId,
    title: "Untitled Note",
    content: "",
    collapsed: false,
  });
  _newlyAddedNoteId = newId;

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
          const nextCollapsed = !Boolean(state.notes[idx].collapsed);
          state.notes[idx].collapsed = nextCollapsed;
          toggleBtn.classList.toggle("is-collapsed", nextCollapsed);
          const wrap = list.querySelector(`[data-note-content-wrap="${noteId}"]`);
          if (wrap) wrap.classList.toggle("notes-content-wrap--collapsed", nextCollapsed);
          scheduleSave();
        }
        return;
      }

      const deleteBtn = e.target?.closest?.("[data-note-delete]");
      if (deleteBtn) {
        const noteId = String(deleteBtn.dataset.noteDelete || "");
        const idx = findNoteIndexById(state, noteId);
        if (idx >= 0) {
          const row = deleteBtn.closest(".notes-item");
          if (row) row.classList.add("notes-item--removing");
          setTimeout(() => {
            const nextIdx = findNoteIndexById(state, noteId);
            if (nextIdx >= 0) state.notes.splice(nextIdx, 1);
            renderNotes(state);
            scheduleSave();
          }, 220);
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
