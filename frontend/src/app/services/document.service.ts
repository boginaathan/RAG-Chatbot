import { Injectable } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { map, filter } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface Document {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  chunkCount: number;
  charCount: number;
  wordCount: number;
  pages?: number;
  processingTimeMs: number;
  status: 'uploading' | 'processing' | 'ready' | 'error';
}

export interface UploadProgress {
  progress: number;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  document?: Document;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private apiUrl = environment.apiUrl;
  private documentsSubject = new BehaviorSubject<Document[]>([]);
  documents$ = this.documentsSubject.asObservable();

  constructor(private http: HttpClient) {
    this.loadDocuments();
  }

  loadDocuments(): void {
    this.http.get<{ documents: Document[] }>(`${this.apiUrl}/documents`)
      .subscribe(response => this.documentsSubject.next(response.documents || []));
  }

  uploadDocument(file: File): Observable<UploadProgress> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<Document>(`${this.apiUrl}/documents/upload`, formData, {
      reportProgress: true,
      observe: 'events'
    }).pipe(
      map(event => {
        if (event.type === HttpEventType.UploadProgress) {
          const progress = Math.round(100 * (event.loaded / (event.total || event.loaded)));
          return { progress, status: 'uploading' as const };
        } else if (event.type === HttpEventType.Response) {
          const document = (event.body as any).document;
          this.addDocument(document);
          return { progress: 100, status: 'complete' as const, document };
        }
        return { progress: 0, status: 'uploading' as const };
      }),
      filter(p => p.progress > 0)
    );
  }

  deleteDocument(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/documents/${id}`).pipe(
      map(result => {
        this.removeDocument(id);
        return result;
      })
    );
  }

  getDocuments(): Document[] {
    return this.documentsSubject.getValue();
  }

  private addDocument(doc: Document): void {
    const current = this.documentsSubject.getValue();
    this.documentsSubject.next([doc, ...current]);
  }

  private removeDocument(id: string): void {
    const current = this.documentsSubject.getValue();
    this.documentsSubject.next(current.filter(d => d.id !== id));
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  getFileIcon(fileType: string): string {
    const icons: Record<string, string> = {
      pdf: '📄', docx: '📝', doc: '📝', txt: '📃', md: '📋'
    };
    return icons[fileType] || '📁';
  }
}
