export interface LineageEdge {
  child: string;
  parent: string;
  relation: string;
}

export function detectCycle(edges: LineageEdge[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.child === e.parent) return [e.child, e.parent];
    const list = adj.get(e.child) ?? [];
    list.push(e.parent);
    adj.set(e.child, list);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const dfs = (n: string): string[] | null => {
    if (visiting.has(n)) return [...stack.slice(stack.indexOf(n)), n];
    if (visited.has(n)) return null;
    visiting.add(n);
    stack.push(n);
    for (const p of adj.get(n) ?? []) {
      const cyc = dfs(p);
      if (cyc) return cyc;
    }
    stack.pop();
    visiting.delete(n);
    visited.add(n);
    return null;
  };

  for (const n of adj.keys()) {
    const cyc = dfs(n);
    if (cyc) return cyc;
  }
  return null;
}

export function parentClosure(root: string, edges: LineageEdge[]): Set<string> {
  const out = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    for (const e of edges) {
      if (e.child === n && !out.has(e.parent)) {
        out.add(e.parent);
        stack.push(e.parent);
      }
    }
  }
  return out;
}

export interface LineageEvent {
  event_id: string;
  eventTime: string;
  producer: string;
  schemaURL: string;
  job: { namespace: string; name: string };
  run: { runId: string };
  inputs: Array<{ namespace: string; name: string; facets?: Record<string, unknown> }>;
  outputs: Array<{ namespace: string; name: string; facets?: Record<string, unknown> }>;
}

export function validateOpenLineage(event: LineageEvent): string[] {
  const errors: string[] = [];
  if (!event.event_id) errors.push("MISSING_EVENT_ID");
  if (!event.job?.name || !event.run?.runId) errors.push("MISSING_JOB_RUN");
  if (!event.schemaURL.includes("openlineage")) errors.push("UNSUPPORTED_SCHEMA");
  return errors;
}
