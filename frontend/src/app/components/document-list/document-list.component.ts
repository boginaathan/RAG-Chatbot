import { Component } from '@angular/core';
import { Output, EventEmitter, Input } from '@angular/core';
import { DocumentService, Document } from '../../services/document.service';
import { ChatService } from '../../services/chat.service';
@Component({
  selector: 'app-document-list',
  template: `
    <div class="doc-list-section">
      <div class="section-header" *ngIf="documents.length > 0">
        <span class="section-title">Documents</span>
        <span class="doc-count">{{ documents.length }}</span>
      </div>
      
      <div class="empty-docs" *ngIf="documents.length === 0">
        <span class="empty-icon">📂</span>
        <span>No documents yet</span>
      </div>
      
      <div class="doc-items">
        <div
          *ngFor="let doc of documents"
          class="doc-item"
          [class.selected]="isSelected(doc.id)"
          (click)="toggleDoc(doc.id)">
          
          <div class="doc-icon">{{ documentService.getFileIcon(doc.fileType) }}</div>
          <div class="doc-info">
            <span class="doc-name" [title]="doc.fileName">{{ doc.fileName }}</span>
            <span class="doc-meta">
              {{ documentService.formatFileSize(doc.fileSize) }}
              · {{ doc.chunkCount }} chunks
              <span *ngIf="doc.pages"> · {{ doc.pages }} pages</span>
            </span>
          </div>
          <div class="doc-actions">
            <div class="check" *ngIf="isSelected(doc.id)">✓</div>
            <button class="del-btn" (click)="deleteDoc($event, doc)" title="Delete">✕</button>
          </div>
        </div>
      </div>
      
      <div class="filter-hint" *ngIf="documents.length > 0">
        <button class="btn-secondary" (click)="clearSelection()">
          Clear document(s) ?
        </button>
      </div>
    </div>
  `,
  styles: [`
    .doc-list-section { padding: 0 16px 16px; flex: 1; overflow-y: auto; }
    
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      
      .section-title { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
      .doc-count { font-size: 11px; color: var(--accent); background: rgba(99,102,241,0.15); padding: 1px 7px; border-radius: 10px; font-weight: 600; }
    }
    
    .empty-docs {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 20px;
      color: var(--text-muted);
      font-size: 13px;
      .empty-icon { font-size: 28px; opacity: 0.4; }
    }
    
    .doc-items { display: flex; flex-direction: column; gap: 4px; }
    
    .doc-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 10px;
      border-radius: 10px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s;
      
      &:hover { background: var(--bg-hover); border-color: var(--border-color); }
      &.selected { background: rgba(99,102,241,0.1); border-color: var(--accent); }
      
      .doc-icon { font-size: 18px; flex-shrink: 0; }
      
      .doc-info {
        flex: 1;
        overflow: hidden;
        .doc-name { display: block; font-size: 13px; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .doc-meta { display: block; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
      }
      
      .doc-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        .check { color: var(--accent); font-size: 12px; font-weight: 700; }
        .del-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 12px;
          padding: 3px 5px;
          border-radius: 4px;
          opacity: 0;
          transition: all 0.15s;
          &:hover { color: var(--error-color); background: rgba(239,68,68,0.1); }
        }
      }
      
      &:hover .del-btn { opacity: 1; }
    }
    
    .filter-hint {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
      padding: 7px 10px;
      background: rgba(99,102,241,0.08);
      border-radius: 8px;
      font-size: 11px;
      color: var(--accent);
      width:122px;
      button {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 11px;
        &:hover { color: var(--text-primary); }
      }
    }
  `]
})
export class DocumentListComponent {
  @Input() selectedDocumentIds: string[] = [];
  @Output() documentToggled = new EventEmitter<string>();

  constructor(public documentService: DocumentService, private chatService: ChatService) { }

  get documents(): Document[] {
    return this.documentService.getDocuments();
  }

  isSelected(id: string): boolean {
    return this.selectedDocumentIds.includes(id);
  }

  toggleDoc(id: string): void {
    this.documentToggled.emit(id);
  }

  clearSelection(): void {
    if (confirm("Are you sure you want to clear documents?")) {
      this.documentService.resetCollection().subscribe({
        next: (res) => {
          this.selectedDocumentIds = [];
          this.documentService.removeAllDocument();
          this.chatService.triggerClearChat();
          console.log('Collection cleared', res);
        },
        error: (err) => {
          console.error(err);
        }
      });
    }
  }

  deleteDoc(event: MouseEvent, doc: Document): void {
    event.stopPropagation();
    if (confirm(`Delete "${doc.fileName}"?`)) {
      this.documentService.deleteDocument(doc.id).subscribe();
    }
  }
}
