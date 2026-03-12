import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: SourceReference[];
  isStreaming?: boolean;
  error?: string;
  meta?: {
    responseTimeMs: number;
    chunksRetrieved: number;
    model?: string;
  };
}

export interface SourceReference {
  fileName: string;
  documentId: string;
  relevanceScore: number;
  textPreview: string;
  chunkIndex: number;
}

export interface ChatResponse {
  answer: string;
  sources: SourceReference[];
  meta: {
    responseTimeMs: number;
    chunksRetrieved: number;
    model: string;
    usage: any;
  };
}

export interface StreamEvent {
  type: 'status' | 'sources' | 'token' | 'done' | 'error';
  message?: string;
  sources?: SourceReference[];
  content?: string;
  fullResponse?: string;
  chunksRetrieved?: number;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private apiUrl = environment.apiUrl;
  private clearChatSource = new Subject<void>();
  clearChat$ = this.clearChatSource.asObservable();
  constructor(private http: HttpClient) {}

  sendMessage(
    query: string,
    documentIds: string[] = [],
    conversationHistory: { role: string; content: string }[] = []
  ): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(`${this.apiUrl}/chat`, {
      query,
      documentIds,
      conversationHistory
    }).pipe(
      catchError(this.handleError)
    );
  }

  sendMessageStream(
    query: string,
    documentIds: string[] = [],
    conversationHistory: { role: string; content: string }[] = []
  ): Observable<StreamEvent> {
    const subject = new Subject<StreamEvent>();

    fetch(`${this.apiUrl}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, documentIds, conversationHistory })
    }).then(async response => {
      if (!response.ok) {
        subject.error(new Error(`HTTP ${response.status}: ${response.statusText}`));
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: StreamEvent = JSON.parse(line.slice(6));
              subject.next(event);
              if (event.type === 'done' || event.type === 'error') {
                subject.complete();
                return;
              }
            } catch {}
          }
        }
      }

      subject.complete();
    }).catch(err => subject.error(err));

    return subject.asObservable();
  }

  getSuggestions(): Observable<{ suggestions: string[]; documentCount: number }> {
    return this.http.get<any>(`${this.apiUrl}/chat/suggestions`);
  }

  private handleError(error: HttpErrorResponse) {
    const message = error.error?.error || error.message || 'Unknown error occurred';
    return throwError(() => new Error(message));
  }

  triggerClearChat() {
    this.clearChatSource.next();
  }
}
