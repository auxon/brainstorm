import { useCallback, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  type Connection,
  type Edge as RFEdge,
  type Node,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Idea, SessionGraph } from "@/lib/api";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

type IdeaNode = Node<{ title: string; votes: number; sats: number }, "idea">;

function IdeaNodeView({ data }: NodeProps<IdeaNode>) {
  return (
    <div className="min-w-[160px] max-w-[220px] rounded-xl border border-accent/30 bg-[#141b24] px-3 py-2 shadow-lg">
      <Handle type="target" position={Position.Left} className="!bg-accent" />
      <p className="text-sm font-medium text-fg">{data.title}</p>
      <p className="mt-1 font-mono text-[10px] text-muted">
        {data.votes} ↑{data.sats ? ` · ${data.sats} sats` : ""}
      </p>
      <Handle type="source" position={Position.Right} className="!bg-accent" />
    </div>
  );
}

const nodeTypes = { idea: IdeaNodeView };

function layout(ideas: Idea[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const byParent = new Map<string | null, Idea[]>();
  for (const idea of ideas) {
    const key = idea.parent_id;
    const list = byParent.get(key) ?? [];
    list.push(idea);
    byParent.set(key, list);
  }
  function walk(parentId: string | null, depth: number, startY: number): number {
    const kids = (byParent.get(parentId) ?? []).sort((a, b) => a.sort_index - b.sort_index);
    let y = startY;
    for (const idea of kids) {
      const stored =
        idea.position_x != null && idea.position_y != null
          ? { x: idea.position_x, y: idea.position_y }
          : { x: depth * 260, y };
      pos.set(idea.id, stored);
      y = walk(idea.id, depth + 1, stored.y) + 110;
    }
    return Math.max(y, startY);
  }
  walk(null, 0, 0);
  return pos;
}

export function MindMap({
  graph,
  slug,
  onUpdate,
}: {
  graph: SessionGraph;
  slug: string;
  onUpdate: (g: SessionGraph) => void;
}) {
  const positions = useMemo(() => layout(graph.ideas), [graph.ideas]);

  const nodes: IdeaNode[] = useMemo(
    () =>
      graph.ideas.map((idea) => ({
        id: idea.id,
        type: "idea",
        position: positions.get(idea.id) ?? { x: 0, y: 0 },
        data: { title: idea.title, votes: idea.vote_count, sats: idea.satoshis },
        draggable: graph.session.canEdit,
      })),
    [graph.ideas, graph.session.canEdit, positions],
  );

  const treeEdges: RFEdge[] = useMemo(
    () =>
      graph.ideas
        .filter((i) => i.parent_id)
        .map((i) => ({
          id: `tree-${i.parent_id}-${i.id}`,
          source: i.parent_id as string,
          target: i.id,
          style: { stroke: "#2ee6c8", strokeWidth: 1.4 },
        })),
    [graph.ideas],
  );

  const extraEdges: RFEdge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source_id,
        target: e.target_id,
        animated: true,
        style: { stroke: "#8b9bb0", strokeDasharray: "4 4" },
      })),
    [graph.edges],
  );

  const onConnect = useCallback(
    async (conn: Connection) => {
      if (!conn.source || !conn.target || !graph.session.canEdit) return;
      try {
        onUpdate(
          await apiFetch<SessionGraph>(
            `/sessions/${slug}/edges`,
            { method: "POST", body: JSON.stringify({ sourceId: conn.source, targetId: conn.target }) },
            slug,
          ),
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not link ideas");
      }
      return addEdge(conn, extraEdges);
    },
    [extraEdges, graph.session.canEdit, onUpdate, slug],
  );

  const onNodeDragStop = useCallback(
    async (_: unknown, node: Node) => {
      if (!graph.session.canEdit) return;
      try {
        await apiFetch(
          `/sessions/${slug}/ideas/${node.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ positionX: node.position.x, positionY: node.position.y }),
          },
          slug,
        );
      } catch {
        /* ignore transient drag errors */
      }
    },
    [graph.session.canEdit, slug],
  );

  return (
    <div className="h-[68vh] overflow-hidden rounded-xl border border-border bg-[#0b0f14]">
      <ReactFlow
        nodes={nodes}
        edges={[...treeEdges, ...extraEdges]}
        nodeTypes={nodeTypes}
        onConnect={(c) => void onConnect(c)}
        onNodeDragStop={(e, n) => void onNodeDragStop(e, n)}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#243042" gap={22} />
        <Controls />
        <MiniMap pannable zoomable style={{ background: "#141b24" }} />
      </ReactFlow>
    </div>
  );
}
