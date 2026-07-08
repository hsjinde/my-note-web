import type { NoteMeta } from '../shared/types';

export interface FolderNode {
  name: string;
  fullPath: string;
  notes: NoteMeta[];
  children: FolderNode[];
}

export function buildFolderTree(notes: NoteMeta[]): FolderNode[] {
  const root: FolderNode[] = [];
  const nodeByPath = new Map<string, FolderNode>();

  const getOrCreate = (segments: string[]): FolderNode => {
    const fullPath = segments.join('/');
    const existing = nodeByPath.get(fullPath);
    if (existing) return existing;
    const node: FolderNode = { name: segments[segments.length - 1], fullPath, notes: [], children: [] };
    nodeByPath.set(fullPath, node);
    if (segments.length === 1) {
      root.push(node);
    } else {
      getOrCreate(segments.slice(0, -1)).children.push(node);
    }
    return node;
  };

  for (const n of notes) {
    getOrCreate(n.folder.split('/')).notes.push(n);
  }

  const sortRec = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    for (const node of nodes) sortRec(node.children);
  };
  sortRec(root);

  return root;
}
