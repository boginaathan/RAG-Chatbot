import { Component, Input } from '@angular/core';
import { SourceReference } from '../../services/chat.service';

@Component({
  selector: 'app-sources-card',
  template: `
    <div class="sources-card">
      <div class="sources-header" (click)="expanded = !expanded">
        <span class="sources-icon">◑</span>
        <span class="sources-label">{{ sources.length }} source{{ sources.length > 1 ? 's' : '' }} retrieved</span>
        <span class="chevron" [class.open]="expanded">›</span>
      </div>
      <div class="sources-list" *ngIf="expanded">
        <div class="source-item" *ngFor="let source of sources; let i = index">
          <div class="source-header">
            <span class="source-num">[{{ i + 1 }}]</span>
            <span class="source-name">{{ source.fileName }}</span>
            <span class="relevance-badge" [style.background]="getRelevanceColor(source.relevanceScore)">
              {{ (source.relevanceScore * 100).toFixed(0) }}%
            </span>
          </div>
          <p class="source-preview">{{ source.textPreview }}...</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .sources-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      overflow: hidden;
      max-width: 680px;
      font-size: 13px;
    }
    
    .sources-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      cursor: pointer;
      user-select: none;
      
      &:hover { background: var(--bg-hover); }
      
      .sources-icon { color: var(--accent); font-size: 14px; }
      .sources-label { flex: 1; color: var(--text-secondary); font-size: 12px; }
      .chevron {
        color: var(--text-muted);
        font-size: 18px;
        transition: transform 0.2s;
        transform: rotate(90deg);
        &.open { transform: rotate(-90deg); }
      }
    }
    
    .sources-list {
      border-top: 1px solid var(--border-color);
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .source-item {
      padding: 8px 10px;
      background: var(--bg-primary);
      border-radius: 8px;
      border: 1px solid var(--border-color);
    }
    
    .source-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 5px;
      
      .source-num { color: var(--accent); font-weight: 700; font-size: 11px; }
      .source-name { flex: 1; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .relevance-badge {
        color: white;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 10px;
      }
    }
    
    .source-preview {
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.5;
      margin: 0;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  `]
})
export class SourcesCardComponent {
  @Input() sources: SourceReference[] = [];
  expanded = false;

  getRelevanceColor(score: number): string {
    if (score >= 0.8) return '#22c55e';
    if (score >= 0.6) return '#f59e0b';
    return '#94a3b8';
  }
}
