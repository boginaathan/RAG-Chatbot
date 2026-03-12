import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef,
  AfterViewChecked, ChangeDetectorRef
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { ChatService, ChatMessage, SourceReference } from '../../services/chat.service';
import { DocumentService, Document } from '../../services/document.service';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss']
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;
  @ViewChild('queryInput') queryInput!: ElementRef;

  messages: ChatMessage[] = [];
  query = '';
  isLoading = false;
  isStreaming = false;
  selectedDocumentIds: string[] = [];
  suggestions: string[] = [];
  sidebarOpen = true;
  private destroy$ = new Subject<void>();
  private shouldScrollToBottom = false;

  constructor(
    private chatService: ChatService,
    private documentService: DocumentService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadSuggestions();
    this.documentService.documents$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.loadSuggestions();
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  loadSuggestions(): void {
    this.chatService.getSuggestions().subscribe(resp => {
      this.suggestions = resp.suggestions;
      this.cdr.detectChanges();
    });
  }

  sendMessage(): void {
    if (!this.query.trim() || this.isLoading) return;

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: this.query.trim(),
      timestamp: new Date()
    };
    this.messages.push(userMessage);
    
    const queryText = this.query;
    this.query = '';
    this.isLoading = true;
    this.shouldScrollToBottom = true;

    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true
    };
    this.messages.push(assistantMessage);

    const conversationHistory = this.messages.slice(-11, -1).map(m => ({
      role: m.role,
      content: m.content
    }));

    this.chatService.sendMessageStream(queryText, this.selectedDocumentIds, conversationHistory)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (event) => {
          const msgIndex = this.messages.findIndex(m => m.id === assistantMessage.id);
          if (msgIndex === -1) return;
          
          const msg = { ...this.messages[msgIndex] };

          if (event.type === 'token' && event.content) {
            msg.content += event.content;
            this.shouldScrollToBottom = true;
          } else if (event.type === 'sources' && event.sources) {
            msg.sources = event.sources;
          } else if (event.type === 'done') {
            msg.isStreaming = false;
            this.isLoading = false;
          } else if (event.type === 'error') {
            msg.isStreaming = false;
            msg.error = event.message;
            this.isLoading = false;
          }

          this.messages[msgIndex] = msg;
          this.cdr.detectChanges();
        },
        error: (error) => {
          const msgIndex = this.messages.findIndex(m => m.id === assistantMessage.id);
          if (msgIndex !== -1) {
            this.messages[msgIndex] = {
              ...this.messages[msgIndex],
              isStreaming: false,
              error: error.message || 'Failed to get response'
            };
          }
          this.isLoading = false;
          this.cdr.detectChanges();
        }
      });
  }

  useSuggestion(suggestion: string): void {
    this.query = suggestion;
    this.sendMessage();
  }

  clearChat(): void {
    this.messages = [];
    this.loadSuggestions();
  }

  toggleDocumentSelection(docId: string): void {
    const idx = this.selectedDocumentIds.indexOf(docId);
    if (idx === -1) {
      this.selectedDocumentIds.push(docId);
    } else {
      this.selectedDocumentIds.splice(idx, 1);
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private scrollToBottom(): void {
    try {
      const el = this.messagesContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch {}
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get documents(): Document[] {
    return this.documentService.getDocuments();
  }

  get hasDocuments(): boolean {
    return this.documents.length > 0;
  }

  trackByMessage(index: number, message: any): any {
    return message.id || index;
  }
}
