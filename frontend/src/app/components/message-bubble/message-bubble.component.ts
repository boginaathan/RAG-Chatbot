import { Component, Input, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ChatMessage } from '../../services/chat.service';

// Simple inline markdown renderer
function renderMarkdown(text: string): string {
  return text
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\[Source (\d+)\]/g, '<cite class="source-cite">[Source $1]</cite>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(.+)$/gm, (m) => m.startsWith('<') ? m : `<p>${m}</p>`);
}

@Component({
  selector: 'app-message-bubble',
  template: `
    <div class="message" [class.user-msg]="message.role === 'user'" [class.assistant-msg]="message.role === 'assistant'">
      <div class="avatar" [class.user-avatar]="message.role === 'user'" [class.ai-avatar]="message.role === 'assistant'">
        {{ message.role === 'user' ? 'U' : '◈' }}
      </div>
      <div class="bubble">
        <div class="content" *ngIf="message.role === 'user'">{{ message.content }}</div>
        <div class="content markdown-content" *ngIf="message.role === 'assistant' && !message.error" [innerHTML]="renderedContent"></div>
        <div class="error-content" *ngIf="message.error">
          <span class="error-icon">⚠</span> {{ message.error }}
        </div>
        <div class="cursor" *ngIf="message.isStreaming"></div>
        <div class="meta" *ngIf="message.role === 'assistant' && !message.isStreaming && !message.error">
          <span class="timestamp">{{ message.timestamp | date:'shortTime' }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .message {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      
      &.user-msg {
        flex-direction: row-reverse;
        
        .bubble {
          background: var(--accent);
          color: white;
          border-radius: 18px 4px 18px 18px;
        }
      }
      
      &.assistant-msg .bubble {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 4px 18px 18px 18px;
      }
    }
    
    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 4px;
      
      &.user-avatar {
        background: var(--accent);
        color: white;
      }
      
      &.ai-avatar {
        background: var(--bg-tertiary);
        color: var(--accent);
        border: 1px solid var(--border-color);
        font-size: 16px;
      }
    }
    
    .bubble {
      padding: 12px 16px;
      max-width: 680px;
      font-size: 14px;
      line-height: 1.65;
      position: relative;
    }
    
    .content { color: inherit; }
    
    .markdown-content {
      color: var(--text-primary);
      
      ::ng-deep {
        p { margin: 0 0 8px; &:last-child { margin-bottom: 0; } }
        h1, h2, h3 { margin: 12px 0 6px; font-size: 15px; color: var(--text-primary); }
        code { background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px; font-size: 12px; font-family: 'Space Mono', monospace; }
        pre { background: var(--bg-tertiary); padding: 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; code { background: none; padding: 0; } }
        ul, ol { padding-left: 20px; margin: 6px 0; }
        li { margin-bottom: 4px; }
        strong { font-weight: 600; }
        .source-cite { color: var(--accent); font-size: 12px; font-style: normal; }
      }
    }
    
    .error-content {
      color: var(--error-color);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .cursor {
      display: inline-block;
      width: 2px;
      height: 16px;
      background: var(--accent);
      margin-left: 2px;
      vertical-align: middle;
      animation: blink 1s step-end infinite;
    }
    
    .meta {
      margin-top: 6px;
      .timestamp { font-size: 11px; color: var(--text-muted); }
    }
    
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MessageBubbleComponent implements OnChanges {
  @Input() message!: ChatMessage;
  renderedContent: SafeHtml = '';

  constructor(private sanitizer: DomSanitizer) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['message'] && this.message?.role === 'assistant') {
      const html = renderMarkdown(this.message.content || '');
      this.renderedContent = this.sanitizer.bypassSecurityTrustHtml(html);
    }
  }
}
