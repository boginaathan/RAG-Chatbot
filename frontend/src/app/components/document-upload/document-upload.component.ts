import { Component } from '@angular/core';
import { DocumentService, UploadProgress } from '../../services/document.service';

@Component({
  selector: 'app-document-upload',
  template: `
    <div class="upload-section">
      <div
        class="drop-zone"
        [class.dragging]="isDragging"
        [class.uploading]="isUploading"
        (dragover)="onDragOver($event)"
        (dragleave)="isDragging = false"
        (drop)="onDrop($event)"
        (click)="fileInput.click()">
        
        <input
          #fileInput
          type="file"
          hidden
          multiple
          accept=".pdf,.txt,.doc,.docx,.md"
          (change)="onFileSelect($event)">
        
        <div class="drop-content" *ngIf="!isUploading">
          <span class="drop-icon">⊕</span>
          <span class="drop-text">Upload Documents</span>
          <span class="drop-hint">PDF, DOCX, TXT, MD</span>
        </div>
        
        <div class="upload-progress" *ngIf="isUploading">
          <div class="progress-ring">
            <svg width="40" height="40">
              <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border-color)" stroke-width="3"/>
              <circle cx="20" cy="20" r="16" fill="none" stroke="var(--accent)" stroke-width="3"
                [style.stroke-dasharray]="'100.5'"
                [style.stroke-dashoffset]="100.5 - (uploadProgress / 100 * 100.5)"
                stroke-linecap="round"
                transform="rotate(-90 20 20)"/>
            </svg>
            <span class="progress-pct">{{ uploadProgress }}%</span>
          </div>
          <span class="uploading-text">{{ uploadStatus }}</span>
        </div>
      </div>
      
      <div class="upload-error" *ngIf="errorMessage">
        ⚠ {{ errorMessage }}
      </div>
    </div>
  `,
  styles: [`
    .upload-section { padding: 12px 16px; }
    
    .drop-zone {
      border: 1.5px dashed var(--border-color);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
      min-height: 80px;
      
      &:hover, &.dragging {
        border-color: var(--accent);
        background: rgba(99, 102, 241, 0.05);
      }
      
      &.uploading { cursor: default; }
    }
    
    .drop-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      
      .drop-icon {
        font-size: 24px;
        color: var(--accent);
        line-height: 1;
      }
      
      .drop-text {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
      }
      
      .drop-hint {
        font-size: 11px;
        color: var(--text-muted);
      }
    }
    
    .upload-progress {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      
      .progress-ring {
        position: relative;
        width: 40px;
        height: 40px;
        
        .progress-pct {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          color: var(--accent);
        }
      }
      
      .uploading-text {
        font-size: 12px;
        color: var(--text-secondary);
      }
    }
    
    .upload-error {
      margin-top: 8px;
      padding: 8px 12px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      color: var(--error-color);
      font-size: 12px;
    }
  `]
})
export class DocumentUploadComponent {
  isDragging = false;
  isUploading = false;
  uploadProgress = 0;
  uploadStatus = 'Uploading...';
  errorMessage = '';

  constructor(private documentService: DocumentService) {}

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = true;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) this.uploadFiles(files);
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (files.length) this.uploadFiles(files);
    input.value = '';
  }

  private uploadFiles(files: File[]): void {
    const file = files[0]; // Upload one at a time for progress tracking
    this.isUploading = true;
    this.errorMessage = '';
    this.uploadProgress = 0;
    this.uploadStatus = `Uploading ${file.name}...`;

    this.documentService.uploadDocument(file).subscribe({
      next: (progress: UploadProgress) => {
        this.uploadProgress = progress.progress;
        if (progress.status === 'complete') {
          this.uploadStatus = 'Processing complete!';
          setTimeout(() => {
            this.isUploading = false;
            this.uploadProgress = 0;
          }, 1000);
        } else {
          this.uploadStatus = `Uploading... ${progress.progress}%`;
        }
      },
      error: (error) => {
        this.isUploading = false;
        this.errorMessage = error.message || 'Upload failed';
        setTimeout(() => this.errorMessage = '', 5000);
      }
    });
  }
}
