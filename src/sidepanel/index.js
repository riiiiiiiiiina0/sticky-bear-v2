// Sticky Bear Panel - Main JavaScript
import { HeroIcons } from './heroicons.js';

class StickyNotesApp {
  constructor() {
    this.notes = [];
    this.iframeMap = new Map();
    this.iframeResizeObservers = new Map();
    this.iframeResizeTimers = new Map();
    this.colors = [
      'yellow', // default
      'green',
      'blue',
      'red',
      'gray',
    ];

    this.init();
  }

  async init() {
    // Load notes from storage
    await this.loadNotes();

    // Set up event listeners
    this.setupEventListeners();

    // Render initial notes
    this.renderNotes();

    // Update badge on initialization
    chrome.runtime.sendMessage({ action: 'update-badge' });
  }

  setupEventListeners() {
    // Add note button
    const addBtn = /** @type {HTMLButtonElement} */ (
      document.getElementById('add-note-btn')
    );
    addBtn.addEventListener('click', () => this.addNote());

    // Listen for keyboard shortcut messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'add-note') {
        this.addNote();
      }
    });
  }

  async loadNotes() {
    try {
      const result = await chrome.storage.sync.get(['stickyNotes']);
      this.notes = result.stickyNotes || [];

      // Migrate existing notes to have order property
      let needsSave = false;
      this.notes.forEach((note, index) => {
        if (typeof note.order !== 'number') {
          note.order = index;
          needsSave = true;
        }
      });

      if (needsSave) {
        await this.saveNotes();
      }
    } catch (error) {
      console.error('Error loading notes:', error);
      this.notes = [];
    }
  }

  async saveNotes() {
    try {
      await chrome.storage.sync.set({ stickyNotes: this.notes });
      // Notify background script to update badge
      chrome.runtime.sendMessage({ action: 'update-badge' });
    } catch (error) {
      console.error('Error saving notes:', error);
    }
  }

  addNote() {
    const newNote = {
      id: Date.now().toString(),
      content: '',
      color: 'yellow', // Default to yellow
      createdAt: new Date().toISOString(),
      isEditing: true,
      url: '',
      iframeHeight: undefined,
      order: 0, // New notes get order 0 (top)
    };

    // Increment order of existing notes
    this.notes.forEach((note) => {
      note.order = (note.order || 0) + 1;
    });

    this.notes.unshift(newNote);
    this.saveNotes();
    this.renderNotes();

    // Focus on the new note's textarea
    setTimeout(() => {
      const noteElement = document.querySelector(
        `[data-note-id="${newNote.id}"]`,
      );
      const textarea = /** @type {HTMLTextAreaElement | null} */ (
        noteElement?.querySelector('.note-textarea')
      );
      if (textarea) {
        textarea.focus();
      }
    }, 100);
  }

  deleteNote(noteId) {
    const index = this.notes.findIndex((note) => note.id === noteId);
    if (index !== -1) {
      // Clean up iframe if exists
      const existing = this.iframeMap.get(noteId);
      if (existing) {
        try {
          existing.remove();
        } catch (_e) {}
        this.iframeMap.delete(noteId);
      }
      const obs = this.iframeResizeObservers.get(noteId);
      if (obs) {
        try {
          obs.disconnect();
        } catch (_e) {}
        this.iframeResizeObservers.delete(noteId);
      }
      const timer = this.iframeResizeTimers.get(noteId);
      if (typeof timer === 'number') {
        clearTimeout(timer);
        this.iframeResizeTimers.delete(noteId);
      }
      this.notes.splice(index, 1);
      this.saveNotes();
      this.renderNotes();
    }
  }

  updateNoteContent(noteId, content) {
    const note = this.notes.find((note) => note.id === noteId);
    if (note) {
      note.content = content;
      this.saveNotes();
    }
  }

  updateNoteColor(noteId, color) {
    const note = this.notes.find((note) => note.id === noteId);
    if (note) {
      const previousColor = note.color;
      note.color = color;
      this.saveNotes();
      // Update DOM in place to avoid re-rendering iframe notes
      const noteElement = document.querySelector(`[data-note-id="${noteId}"]`);
      if (noteElement) {
        noteElement.classList.remove(`note-theme-${previousColor}`);
        noteElement.classList.add(`note-theme-${color}`);
      }
    }
  }

  moveNoteUp(noteId) {
    const note = this.notes.find((n) => n.id === noteId);
    if (!note) return;

    // Find the note with the next lower order value (visually above)
    const sortedNotes = this.notes
      .filter((n) => n.order < note.order)
      .sort((a, b) => b.order - a.order);

    if (sortedNotes.length > 0) {
      const targetNote = sortedNotes[0];
      const tempOrder = note.order;
      note.order = targetNote.order;
      targetNote.order = tempOrder;

      this.saveNotes();
      this.updateNotesOrder();
    }
  }

  moveNoteDown(noteId) {
    const note = this.notes.find((n) => n.id === noteId);
    if (!note) return;

    // Find the note with the next higher order value (visually below)
    const sortedNotes = this.notes
      .filter((n) => n.order > note.order)
      .sort((a, b) => a.order - b.order);

    if (sortedNotes.length > 0) {
      const targetNote = sortedNotes[0];
      const tempOrder = note.order;
      note.order = targetNote.order;
      targetNote.order = tempOrder;

      this.saveNotes();
      this.updateNotesOrder();
    }
  }

  updateNotesOrder() {
    // Update the flex order of existing DOM elements instead of re-rendering
    this.notes.forEach((note) => {
      const noteElement = /** @type {HTMLElement | null} */ (
        document.querySelector(`[data-note-id="${note.id}"]`)
      );
      if (noteElement) {
        noteElement.style.order = note.order.toString();
      }
    });
  }

  toggleNoteEdit(noteId) {
    const note = this.notes.find((note) => note.id === noteId);
    if (note) {
      // Do not toggle edit mode if showing iframe
      if (note.url && note.url.length > 0) return;
      note.isEditing = !note.isEditing;
      const contentElement = document.querySelector(
        `.note-content[data-note-id="${noteId}"]`,
      );
      if (!contentElement) return;
      if (note.isEditing) {
        contentElement.innerHTML = `<textarea class="note-textarea" placeholder="Write your note here... (supports Markdown)" data-note-id="${
          note.id
        }">${note.content || ''}</textarea>`;
        const textarea = /** @type {HTMLTextAreaElement | null} */ (
          contentElement.querySelector('.note-textarea')
        );
        if (textarea) {
          this.attachTextareaListenersFor(noteId, textarea);
          // focus after microtask
          setTimeout(() => textarea.focus(), 0);
        }
      } else {
        contentElement.innerHTML = `<div class="note-preview">${this.renderMarkdown(
          note.content || '',
        )}</div>`;
      }
    }
  }

  renderNotes() {
    const container = /** @type {HTMLDivElement} */ (
      document.getElementById('notes-container')
    );
    const emptyState = /** @type {HTMLDivElement} */ (
      document.getElementById('empty-state')
    );

    if (this.notes.length === 0) {
      container.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    // Sort notes by order for rendering
    const sortedNotes = [...this.notes].sort(
      (a, b) => (a.order || 0) - (b.order || 0),
    );
    container.innerHTML = sortedNotes
      .map((note) => this.renderNote(note))
      .join('');

    // Add event listeners to the rendered notes
    this.attachNoteEventListeners();
  }

  renderNote(note) {
    const isEditing = note.isEditing;
    const content = note.content || '';

    return `
      <div class="sticky-note note-theme-${note.color}" data-note-id="${
      note.id
    }" style="order: ${note.order || 0}">
        <div class="note-header">
          <div class="note-controls-left">
            <div class="color-picker" data-color="${
              note.color
            }" title="Change color"></div>
          </div>
          <div class="note-controls-right">
            <button class="move-btn move-up-btn" data-note-id="${
              note.id
            }" title="Move up">${HeroIcons.arrowUp}</button>
            <button class="move-btn move-down-btn" data-note-id="${
              note.id
            }" title="Move down">${HeroIcons.arrowDown}</button>
            <button class="link-btn" data-note-id="${
              note.id
            }" title="Set/clear webpage URL">${HeroIcons.link}</button>
            <button class="delete-btn" data-note-id="${
              note.id
            }" title="Delete note">${HeroIcons.trash}</button>
          </div>
        </div>
        <div class="note-content" data-note-id="${note.id}">
          ${
            note.url && note.url.length > 0
              ? `<div class="iframe-wrapper" data-resize-id="${
                  note.id
                }" style="${
                  typeof note.iframeHeight === 'number'
                    ? `height: ${note.iframeHeight}px;`
                    : ''
                }"><div class="iframe-container" data-iframe-container="${
                  note.id
                }"></div></div>`
              : isEditing
              ? `<textarea class="note-textarea" placeholder="Write your note here... (supports Markdown)" data-note-id="${note.id}">${content}</textarea>`
              : `<div class="note-preview">${this.renderMarkdown(
                  content,
                )}</div>`
          }
        </div>
      </div>
    `;
  }

  renderMarkdown(content) {
    if (!content.trim()) {
      return '<p style="color: var(--text-secondary); font-style: italic;">Click to edit...</p>';
    }

    try {
      // Use the marked library that's loaded globally
      return (
        // @ts-ignore - BundledCode is loaded from external script
        window.BundledCode?.marked(content) ||
        `<p>${this.escapeHtml(content)}</p>`
      );
    } catch (error) {
      console.error('Error rendering markdown:', error);
      return `<p>${this.escapeHtml(content)}</p>`;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  attachNoteEventListeners() {
    const container = /** @type {HTMLDivElement} */ (
      document.getElementById('notes-container')
    );

    // Delete buttons
    document.querySelectorAll('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const noteId = /** @type {HTMLButtonElement} */ (btn).dataset.noteId;
        this.deleteNote(noteId);
      });
    });

    // Color pickers
    document.querySelectorAll('.color-picker').forEach((picker) => {
      picker.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showColorPicker(picker);
      });
    });

    // Move buttons
    document.querySelectorAll('.move-up-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const noteId = /** @type {HTMLButtonElement} */ (btn).dataset.noteId;
        this.moveNoteUp(noteId);
      });
    });

    document.querySelectorAll('.move-down-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const noteId = /** @type {HTMLButtonElement} */ (btn).dataset.noteId;
        this.moveNoteDown(noteId);
      });
    });

    // Link buttons
    document.querySelectorAll('.link-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const noteId = /** @type {HTMLButtonElement} */ (btn).dataset.noteId;
        const note = this.notes.find((n) => n.id === noteId);
        if (!note) return;
        const current = note.url || '';
        const input = window.prompt(
          'Enter webpage URL (leave blank to clear):',
          current,
        );
        if (input === null) return; // cancelled
        const trimmed = input.trim();
        if (trimmed === '') {
          note.url = '';
          note.iframeHeight = undefined;
          const obs = this.iframeResizeObservers.get(note.id);
          if (obs) {
            try {
              obs.disconnect();
            } catch (_e) {}
            this.iframeResizeObservers.delete(note.id);
          }
          const timer = this.iframeResizeTimers.get(note.id);
          if (typeof timer === 'number') {
            clearTimeout(timer);
            this.iframeResizeTimers.delete(note.id);
          }
          // keep content editing available
          this.saveNotes();
          this.renderNotes();
          return;
        }
        try {
          const u = new URL(trimmed);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            alert('Only http/https URLs are supported.');
            return;
          }
        } catch (_e) {
          alert('Please enter a valid URL.');
          return;
        }
        note.url = trimmed;
        note.isEditing = false;
        this.saveNotes();
        this.renderNotes();
      });
    });

    // Note content areas (for toggling edit mode)
    document.querySelectorAll('.note-content').forEach((content) => {
      content.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        const contentElement = /** @type {HTMLDivElement} */ (content);
        const noteId = contentElement.dataset.noteId;
        const note = this.notes.find((n) => n.id === noteId);
        if (note && note.url && note.url.length > 0) {
          // If showing webpage, do not toggle edit on click inside content
          return;
        }

        // Don't trigger edit mode if clicking on textarea
        if (target && target.classList.contains('note-textarea')) {
          return;
        }

        // Check if we clicked on the preview area, any child of it, or the content area itself
        if (
          target &&
          (target.classList.contains('note-preview') ||
            target.closest('.note-preview') ||
            target === contentElement)
        ) {
          this.toggleNoteEdit(noteId);
        }
      });
    });

    // Textareas (initial render only). New textareas will use attachTextareaListenersFor
    document.querySelectorAll('.note-textarea').forEach((textarea) => {
      const textareaElement = /** @type {HTMLTextAreaElement} */ (textarea);
      const noteId = /** @type {string} */ (textareaElement.dataset.noteId);
      this.attachTextareaListenersFor(noteId, textareaElement);
    });

    // After wiring events, (re)mount iframes for notes with URLs
    this.notes.forEach((note) => {
      if (note.url && note.url.length > 0) {
        this.mountIframeForNote(note);
      }
    });
  }

  /**
   * Attach input/blur/keydown listeners to a specific textarea without full re-render.
   * @param {string} noteId
   * @param {HTMLTextAreaElement} textareaElement
   */
  attachTextareaListenersFor(noteId, textareaElement) {
    // Auto-save on input
    textareaElement.addEventListener('input', () => {
      this.updateNoteContent(noteId, textareaElement.value);
    });

    // Exit edit mode on blur (with delay to allow for other interactions)
    textareaElement.addEventListener('blur', () => {
      setTimeout(() => {
        const note = this.notes.find((n) => n.id === noteId);
        if (note && note.isEditing) {
          note.isEditing = false;
          const contentElement = document.querySelector(
            `.note-content[data-note-id="${noteId}"]`,
          );
          if (contentElement) {
            contentElement.innerHTML = `<div class="note-preview">${this.renderMarkdown(
              note.content || '',
            )}</div>`;
          }
        }
      }, 150);
    });

    // Handle keyboard shortcuts
    textareaElement.addEventListener('keydown', (e) => {
      const keyboardEvent = /** @type {KeyboardEvent} */ (e);
      if (keyboardEvent.key === 'Escape') {
        const note = this.notes.find((n) => n.id === noteId);
        if (note) {
          note.isEditing = false;
          const contentElement = document.querySelector(
            `.note-content[data-note-id="${noteId}"]`,
          );
          if (contentElement) {
            contentElement.innerHTML = `<div class=\"note-preview\">${this.renderMarkdown(
              note.content || '',
            )}</div>`;
          }
        }
      }
    });
  }

  /**
   * Ensure iframe for a note is created once and mounted into the container without reloading.
   * @param {{id:string,url:string}} note
   */
  mountIframeForNote(note) {
    const container = /** @type {HTMLDivElement|null} */ (
      document.querySelector(
        `.iframe-container[data-iframe-container="${note.id}"]`,
      )
    );
    if (!container) return;

    let iframe = this.iframeMap.get(note.id);
    if (!iframe) {
      iframe = /** @type {HTMLIFrameElement} */ (
        document.createElement('iframe')
      );
      iframe.setAttribute(
        'sandbox',
        'allow-same-origin allow-scripts allow-forms allow-popups allow-downloads',
      );
      iframe.setAttribute(
        'allow',
        'fullscreen; clipboard-read; clipboard-write',
      );
      iframe.name = `sbp-iframe-${note.id}`;
      iframe.style.border = '0';
      this.iframeMap.set(note.id, iframe);
      // Set src only when creating or if different
      iframe.src = note.url;
    } else {
      if (iframe.src !== note.url) {
        iframe.src = note.url;
      }
    }
    if (iframe.parentElement !== container) {
      try {
        container.appendChild(iframe);
      } catch (_e) {}
    }

    // Attach or refresh ResizeObserver on wrapper to remember height
    const wrapper = /** @type {HTMLDivElement|null} */ (
      container.closest('.iframe-wrapper')
    );
    if (!wrapper) return;

    const existingObserver = this.iframeResizeObservers.get(note.id);
    if (existingObserver) {
      try {
        existingObserver.disconnect();
      } catch (_e) {}
    }

    const observer = new ResizeObserver(() => {
      // Disable pointer events on iframe during resize to prevent mouse capture
      const iframe = wrapper.querySelector('iframe');
      if (iframe) {
        iframe.style.pointerEvents = 'none';
      }

      const prevTimer = this.iframeResizeTimers.get(note.id);
      if (typeof prevTimer === 'number') clearTimeout(prevTimer);
      const timerId = /** @type {number} */ (
        setTimeout(() => {
          const currentWrapper = document.querySelector(
            `.iframe-wrapper[data-resize-id="${note.id}"]`,
          );
          if (!currentWrapper) return;
          const rect = currentWrapper.getBoundingClientRect();
          const height = Math.max(0, Math.round(rect.height));
          const n = this.notes.find((m) => m.id === note.id);
          if (n && n.iframeHeight !== height) {
            n.iframeHeight = height;
            this.saveNotes();
          }

          // Re-enable pointer events on iframe after resize is done
          const iframe = currentWrapper.querySelector('iframe');
          if (iframe) {
            iframe.style.pointerEvents = '';
          }
        }, 300)
      );
      this.iframeResizeTimers.set(note.id, timerId);
    });

    try {
      observer.observe(wrapper);
      this.iframeResizeObservers.set(note.id, observer);
    } catch (_e) {}
  }

  showColorPicker(pickerElement) {
    const noteElement = /** @type {HTMLElement} */ (
      pickerElement.closest('.sticky-note')
    );
    const noteId = noteElement.dataset.noteId;

    // Create color picker dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'color-picker-dropdown';
    dropdown.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 6px;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 4px;
      box-shadow: var(--shadow);
      z-index: 1000;
    `;

    this.colors.forEach((color) => {
      const colorBtn = document.createElement('button');
      colorBtn.className = `color-option note-theme-${color}`;
      colorBtn.style.cssText = `
        width: 20px;
        height: 20px;
        border: 2px solid var(--border-color);
        border-radius: 50%;
        cursor: pointer;
        transition: transform 0.2s ease;
      `;

      colorBtn.addEventListener('click', () => {
        this.updateNoteColor(noteId, color);
        dropdown.remove();
      });

      colorBtn.addEventListener('mouseenter', () => {
        colorBtn.style.transform = 'scale(1.1)';
      });

      colorBtn.addEventListener('mouseleave', () => {
        colorBtn.style.transform = 'scale(1)';
      });

      dropdown.appendChild(colorBtn);
    });

    // Position dropdown relative to picker
    const pickerRect = pickerElement.getBoundingClientRect();
    const noteControls = pickerElement.closest('.note-controls-left');
    noteControls.style.position = 'relative';
    noteControls.appendChild(dropdown);

    // Close dropdown when clicking outside
    const closeDropdown = (e) => {
      if (!dropdown.contains(e.target) && e.target !== pickerElement) {
        dropdown.remove();
        document.removeEventListener('click', closeDropdown);
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeDropdown);
    }, 0);
  }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new StickyNotesApp();
});
