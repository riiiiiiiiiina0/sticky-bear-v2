// Sticky Bear Panel - Main JavaScript
class StickyNotesApp {
  constructor() {
    this.notes = [];
    this.draggedNote = null;
    this.draggedIndex = -1;
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

    // Handle drag and drop for reordering
    this.setupDragAndDrop();
  }

  setupDragAndDrop() {
    const container = /** @type {HTMLDivElement} */ (
      document.getElementById('notes-container')
    );

    // Set up drag and drop event listeners on the container
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }

      if (this.draggedNote) {
        this.updateDragPreview(container, e.clientY);
      }
    });

    container.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (this.draggedNote) {
        container.classList.add('dragging-active');
      }
    });

    container.addEventListener('dragleave', (e) => {
      // Only remove dragging-active if we're leaving the container entirely
      if (!container.contains(/** @type {Node} */ (e.relatedTarget))) {
        container.classList.remove('dragging-active');
        this.clearDragPreview();
      }
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      container.classList.remove('dragging-active');
      this.clearDragPreview();

      if (this.draggedNote) {
        const newIndex = Array.from(container.children).indexOf(
          this.draggedNote,
        );
        if (newIndex !== this.draggedIndex) {
          // Reorder notes array
          const [movedNote] = this.notes.splice(this.draggedIndex, 1);
          this.notes.splice(newIndex, 0, movedNote);
          this.saveNotes();
        }
      }
    });
  }

  updateDragPreview(container, y) {
    this.clearDragPreview();

    const afterElement = this.getDragAfterElement(container, y);

    // Add visual feedback to nearby elements
    const allNotes = [
      ...container.querySelectorAll('.sticky-note:not(.dragging)'),
    ];
    allNotes.forEach((note, index) => {
      const noteElement = /** @type {HTMLElement} */ (note);
      const rect = noteElement.getBoundingClientRect();
      const distance = Math.abs(y - (rect.top + rect.height / 2));

      if (distance < 100) {
        // Within 100px
        noteElement.classList.add('drag-over');
      }
    });

    // Move the dragged element
    if (afterElement == null) {
      container.appendChild(this.draggedNote);
    } else {
      container.insertBefore(this.draggedNote, afterElement);
    }
  }

  clearDragPreview() {
    // Remove drag-over class from all notes
    document.querySelectorAll('.sticky-note').forEach((note) => {
      note.classList.remove('drag-over');
    });
  }

  getDragAfterElement(container, y) {
    const draggableElements = [
      ...container.querySelectorAll('.sticky-note:not(.dragging)'),
    ];

    return draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      },
      { offset: Number.NEGATIVE_INFINITY },
    ).element;
  }

  async loadNotes() {
    try {
      const result = await chrome.storage.sync.get(['stickyNotes']);
      this.notes = result.stickyNotes || [];
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
    };

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
      note.color = color;
      this.saveNotes();
      this.renderNotes();
    }
  }

  toggleNoteEdit(noteId) {
    const note = this.notes.find((note) => note.id === noteId);
    if (note) {
      note.isEditing = !note.isEditing;
      this.renderNotes();

      if (note.isEditing) {
        setTimeout(() => {
          const noteElement = document.querySelector(
            `[data-note-id="${noteId}"]`,
          );
          const textarea = /** @type {HTMLTextAreaElement | null} */ (
            noteElement?.querySelector('.note-textarea')
          );
          if (textarea) {
            textarea.focus();
          }
        }, 100);
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

    container.innerHTML = this.notes
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
    }" draggable="true">
        <div class="note-header">
          <div class="note-drag-handle">
            <span class="note-drag-icon">☰</span>
          </div>
          <div class="note-controls">
            <div class="color-picker" data-color="${
              note.color
            }" title="Change color"></div>
            <button class="delete-btn" data-note-id="${
              note.id
            }" title="Delete note">
              🗑️
            </button>
          </div>
        </div>
        <div class="note-content" data-note-id="${note.id}">
          ${
            isEditing
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

    // Set up drag events for each note
    document.querySelectorAll('.sticky-note').forEach((note) => {
      const noteElement = /** @type {HTMLElement} */ (note);

      noteElement.addEventListener('dragstart', (e) => {
        this.draggedNote = noteElement;
        this.draggedIndex = Array.from(container.children).indexOf(noteElement);

        // Add dragging class with a slight delay for smooth animation
        setTimeout(() => {
          noteElement.classList.add('dragging');
        }, 0);

        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/html', noteElement.outerHTML);

          // Create a custom drag image for better visual feedback
          const dragImage = /** @type {HTMLElement} */ (
            noteElement.cloneNode(true)
          );
          dragImage.style.transform = 'rotate(3deg) scale(1.02)';
          dragImage.style.opacity = '0.9';
          document.body.appendChild(dragImage);
          e.dataTransfer.setDragImage(dragImage, e.offsetX, e.offsetY);

          // Remove the temporary drag image after a short delay
          setTimeout(() => {
            document.body.removeChild(dragImage);
          }, 0);
        }
      });

      noteElement.addEventListener('dragend', (e) => {
        if (this.draggedNote) {
          // Smooth transition back to normal state
          this.draggedNote.classList.remove('dragging');
          container.classList.remove('dragging-active');
          this.clearDragPreview();

          // Reset drag state
          this.draggedNote = null;
          this.draggedIndex = -1;
        }
      });
    });

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

    // Note content areas (for toggling edit mode)
    document.querySelectorAll('.note-content').forEach((content) => {
      content.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        const contentElement = /** @type {HTMLDivElement} */ (content);

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
          const noteId = contentElement.dataset.noteId;
          this.toggleNoteEdit(noteId);
        }
      });
    });

    // Textareas
    document.querySelectorAll('.note-textarea').forEach((textarea) => {
      const textareaElement = /** @type {HTMLTextAreaElement} */ (textarea);

      // Auto-save on input
      textareaElement.addEventListener('input', (e) => {
        const noteId = textareaElement.dataset.noteId;
        this.updateNoteContent(noteId, textareaElement.value);
      });

      // Exit edit mode on blur (with delay to allow for other interactions)
      textareaElement.addEventListener('blur', (e) => {
        setTimeout(() => {
          const noteId = textareaElement.dataset.noteId;
          const note = this.notes.find((n) => n.id === noteId);
          if (note && note.isEditing) {
            note.isEditing = false;
            this.renderNotes();
          }
        }, 150);
      });

      // Handle keyboard shortcuts
      textareaElement.addEventListener('keydown', (e) => {
        const keyboardEvent = /** @type {KeyboardEvent} */ (e);
        if (keyboardEvent.key === 'Escape') {
          const noteId = textareaElement.dataset.noteId;
          this.toggleNoteEdit(noteId);
        }
      });
    });
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
      right: 0;
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
    const noteControls = pickerElement.closest('.note-controls');
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
