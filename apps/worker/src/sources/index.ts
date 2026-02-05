import type { SourceForum } from '@ilr/db';
import type { SourceAdapter } from '@ilr/shared';
import { createImmigrationBoardsAdapter } from './immigration-boards.js';

// Registry of source adapters
const adapterFactories: Record<string, (source: SourceForum) => SourceAdapter> = {
  'immigrationboards': createImmigrationBoardsAdapter,
  // Add more adapters here as needed:
  // 'ukvisa-reddit': createRedditAdapter,
  // 'some-other-forum': createOtherForumAdapter,
};

export function getSourceAdapter(source: SourceForum): SourceAdapter | null {
  const factory = adapterFactories[source.name];
  if (!factory) {
    return null;
  }
  return factory(source);
}

export function listAvailableAdapters(): string[] {
  return Object.keys(adapterFactories);
}
