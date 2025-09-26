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

    // Add icons to buttons
    this.setupButtonIcons();

    // Render initial notes
    this.renderNotes();

    // Update badge on initialization
    chrome.runtime.sendMessage({ action: 'update-badge' });

    // Signal that side panel is ready to receive messages
    chrome.runtime.sendMessage({ action: 'sidepanel-ready' });
  }

  setupEventListeners() {
    // Add note button
    const addBtn = /** @type {HTMLButtonElement} */ (
      document.getElementById('add-note-btn')
    );
    addBtn.addEventListener('click', () => this.addNote());

    // Add URL note button
    const addUrlBtn = /** @type {HTMLButtonElement} */ (
      document.getElementById('add-url-note-btn')
    );
    addUrlBtn.addEventListener('click', () => this.addNoteWithUrl());

    // Listen for keyboard shortcut messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'add-note') {
        this.addNote();
      } else if (message.action === 'add-url-note') {
        this.addNoteWithUrl();
      } else if (message.action === 'add-url-note-with-url') {
        this.addNoteWithUrl(message.url);
      }
    });
  }

  setupButtonIcons() {
    // Add plus icon to add note button
    const addBtn = /** @type {HTMLButtonElement} */ (
      document.getElementById('add-note-btn')
    );
    addBtn.innerHTML = HeroIcons.plus;

    // Add globe icon to add URL note button
    const addUrlBtn = /** @type {HTMLButtonElement} */ (
      document.getElementById('add-url-note-btn')
    );
    addUrlBtn.innerHTML = HeroIcons.link;
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

    // Update order of existing DOM elements instead of re-rendering
    this.updateNotesOrder();

    // Add new note DOM element
    this.addNoteToDOM(newNote);

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

  askForUrl(hint = '', defaultUrl = '') {
    let urlInput = window.prompt(hint, defaultUrl);

    if (urlInput === null) return null; // User cancelled

    urlInput = urlInput.trim();

    if (!urlInput.startsWith('http')) {
      urlInput = `https://${urlInput}`;
    }

    return urlInput;
  }

  addNoteWithUrl(predefinedUrl = '') {
    let urlInput = predefinedUrl;

    // If no URL was provided, prompt for one
    if (!urlInput) {
      const promptResult = this.askForUrl(
        'Enter a webpage URL to create a sticky note for:',
        '',
      );

      if (promptResult === null) return; // User cancelled

      if (promptResult === '') {
        alert('Please enter a valid URL.');
        return;
      }

      urlInput = promptResult;
    }

    // Validate URL
    try {
      const url = new URL(urlInput);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        alert('Only http/https URLs are supported.');
        return;
      }
    } catch (error) {
      alert('Please enter a valid URL.');
      return;
    }

    const newNote = {
      id: Date.now().toString(),
      content: '',
      color: 'blue', // Default to blue for URL notes
      createdAt: new Date().toISOString(),
      isEditing: false, // URL notes start in view mode
      url: urlInput,
      iframeHeight: 300, // Default height for iframe
      order: 0, // New notes get order 0 (top)
    };

    // Increment order of existing notes
    this.notes.forEach((note) => {
      note.order = (note.order || 0) + 1;
    });

    this.notes.unshift(newNote);
    this.saveNotes();

    // Update order of existing DOM elements instead of re-rendering
    this.updateNotesOrder();

    // Add new note DOM element
    this.addNoteToDOM(newNote);
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

      // Remove note from array
      this.notes.splice(index, 1);
      this.saveNotes();

      // Remove note DOM element instead of re-rendering everything
      this.removeNoteFromDOM(noteId);

      // Show empty state if no notes left
      if (this.notes.length === 0) {
        const emptyState = /** @type {HTMLDivElement} */ (
          document.getElementById('empty-state')
        );
        emptyState.style.display = 'block';
      }
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

  addNoteToDOM(note) {
    const container = /** @type {HTMLDivElement} */ (
      document.getElementById('notes-container')
    );
    const emptyState = /** @type {HTMLDivElement} */ (
      document.getElementById('empty-state')
    );

    // Hide empty state if it was showing
    if (emptyState.style.display !== 'none') {
      emptyState.style.display = 'none';
    }

    // Create new note element
    const noteElement = document.createElement('div');
    noteElement.innerHTML = this.renderNote(note);
    const actualNoteElement = noteElement.firstElementChild;

    // Insert the note into the container
    if (actualNoteElement) {
      container.appendChild(actualNoteElement);
    }

    // Attach event listeners to the new note
    if (actualNoteElement) {
      this.attachNoteEventListenersToElement(actualNoteElement);

      // If note has a URL, mount its iframe
      if (note.url && note.url.length > 0) {
        this.mountIframeForNote(note);
      }
    }
  }

  removeNoteFromDOM(noteId) {
    const noteElement = document.querySelector(`[data-note-id="${noteId}"]`);
    if (noteElement) {
      noteElement.remove();
    }
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

    // Attach listeners to all note elements
    document.querySelectorAll('.sticky-note').forEach((noteElement) => {
      this.attachNoteEventListenersToElement(noteElement);
    });

    // After wiring events, (re)mount iframes for notes with URLs
    this.notes.forEach((note) => {
      if (note.url && note.url.length > 0) {
        this.mountIframeForNote(note);
      }
    });
  }

  attachNoteEventListenersToElement(noteElement) {
    const noteId = noteElement.dataset.noteId;

    // Delete button
    const deleteBtn = noteElement.querySelector('.delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteNote(noteId);
      });
    }

    // Color picker
    const colorPicker = noteElement.querySelector('.color-picker');
    if (colorPicker) {
      colorPicker.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showColorPicker(colorPicker);
      });
    }

    // Move buttons
    const moveUpBtn = noteElement.querySelector('.move-up-btn');
    if (moveUpBtn) {
      moveUpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.moveNoteUp(noteId);
      });
    }

    const moveDownBtn = noteElement.querySelector('.move-down-btn');
    if (moveDownBtn) {
      moveDownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.moveNoteDown(noteId);
      });
    }

    // Link button
    const linkBtn = noteElement.querySelector('.link-btn');
    if (linkBtn) {
      linkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const note = this.notes.find((n) => n.id === noteId);
        if (!note) return;
        const current = note.url || '';
        const input = this.askForUrl(
          'Enter webpage URL (leave blank to clear):',
          current,
        );
        if (input === null) return; // cancelled
        if (input === '') {
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
          // Update content display to show text editing instead of iframe
          const contentElement = noteElement.querySelector('.note-content');
          if (contentElement) {
            contentElement.innerHTML = note.isEditing
              ? `<textarea class="note-textarea" placeholder="Write your note here... (supports Markdown)" data-note-id="${
                  note.id
                }">${note.content || ''}</textarea>`
              : `<div class="note-preview">${this.renderMarkdown(
                  note.content || '',
                )}</div>`;

            // Re-attach listeners for new textarea if in editing mode
            if (note.isEditing) {
              const textarea = contentElement.querySelector('.note-textarea');
              if (textarea) {
                this.attachTextareaListenersFor(note.id, textarea);
              }
            }
          }
          this.saveNotes();
          return;
        }
        try {
          const u = new URL(input);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            alert('Only http/https URLs are supported.');
            return;
          }
        } catch (_e) {
          alert('Please enter a valid URL.');
          return;
        }
        note.url = input;
        note.isEditing = false;
        // Set default iframe height if not already set
        if (typeof note.iframeHeight !== 'number') {
          note.iframeHeight = 300; // Default height for new iframe notes
        }
        this.saveNotes();

        // Update content display to show iframe instead of text
        const contentElement = noteElement.querySelector('.note-content');
        if (contentElement) {
          contentElement.innerHTML = `<div class="iframe-wrapper" data-resize-id="${
            note.id
          }" style="${
            typeof note.iframeHeight === 'number'
              ? `height: ${note.iframeHeight}px;`
              : ''
          }"><div class="iframe-container" data-iframe-container="${
            note.id
          }"></div></div>`;

          // Mount the iframe
          this.mountIframeForNote(note);
        }
      });
    }

    // Note content area (for toggling edit mode)
    const contentElement = noteElement.querySelector('.note-content');
    if (contentElement) {
      contentElement.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
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
    }

    // Textarea (if exists)
    const textarea = noteElement.querySelector('.note-textarea');
    if (textarea) {
      const textareaElement = /** @type {HTMLTextAreaElement} */ (textarea);
      this.attachTextareaListenersFor(noteId, textareaElement);
    }
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
