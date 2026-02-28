import json
from pyvis.network import Network


def create_stepped_visualization():
    with open("graph.json", "r") as f:
        graph_data = json.load(f)
    with open("simulation_log.json", "r") as f:
        log_data = json.load(f)

    node_depths = {entry["from"]: entry["depth"] for entry in log_data}
    node_content = {entry["from"]: entry["content"] for entry in log_data}
    max_depth = max(node_depths.values())

    net = Network(height="750px", width="100%", bgcolor="#1a1a2e", font_color="white")
    net.force_atlas_2based()

    depth_colors = {0: "#fdbb2d", 1: "#e74c3c", 2: "#2ecc71", 3: "#3498db"}

    # Build full content map for the side panel (strip <think> reasoning)
    panel_content = {}
    for node in graph_data["nodes"]:
        agent_id = node["id"]
        raw = node_content.get(agent_id, "")
        if "</think>" in raw:
            raw = raw.split("</think>", 1)[1].strip()
        panel_content[agent_id] = {
            "name": node["metadata"].get("full_name", agent_id),
            "occupation": node["metadata"].get("occupation", ""),
            "depth": node_depths.get(agent_id, 99),
            "text": raw,
        }

    for node in graph_data["nodes"]:
        agent_id = node["id"]
        depth = node_depths.get(agent_id, 99)
        color = depth_colors.get(depth, "#888888")
        name = node["metadata"].get("full_name", agent_id)

        net.add_node(
            agent_id,
            label=f"{agent_id}\n{name.split()[0]}",
            title="",  # disable default tooltip
            color=color,
            size=30 if depth == 0 else 22,
            hidden=True,
            x=0,
            y=0,
        )

    for edge in graph_data["edges"]:
        net.add_edge(edge["source"], edge["target"], hidden=True, color="#444466")

    # Build per-depth node/edge reveal data to embed in JS
    nodes_by_depth = {}
    for entry in log_data:
        d = entry["depth"]
        nodes_by_depth.setdefault(d, []).append(entry["from"])

    edges_by_depth = {}
    for edge in graph_data["edges"]:
        src, tgt = edge["source"], edge["target"]
        src_depth = node_depths.get(src, 99)
        tgt_depth = node_depths.get(tgt, 99)
        reveal_at = max(src_depth, tgt_depth)
        edges_by_depth.setdefault(reveal_at, []).append((src, tgt))

    nodes_js = json.dumps(nodes_by_depth)
    edges_js = json.dumps(
        {str(k): [list(e) for e in v] for k, v in edges_by_depth.items()}
    )
    panel_js = json.dumps(panel_content)

    step_js = f"""
    var nodesByDepth = {nodes_js};
    var edgesByDepth = {edges_js};
    var panelContent = {panel_js};
    var currentDepth = -1;
    var maxDepth = {max_depth};

    var depthLabels = ["Seeds", "Wave 1", "Wave 2", "Wave 3"];
    var depthColors = {{"0":"#fdbb2d","1":"#e74c3c","2":"#2ecc71","3":"#3498db"}};

    function showPanel(nodeId) {{
        var info = panelContent[nodeId];
        if (!info) return;
        var depth = String(info.depth);
        var color = depthColors[depth] || "#888";
        var badge = depthLabels[info.depth] || ("Wave " + info.depth);
        document.getElementById('panel-name').innerText = info.name;
        document.getElementById('panel-meta').innerHTML =
            '<span style="background:' + color + ';color:#1a1a2e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;">'
            + badge + '</span>&nbsp;&nbsp;' + info.occupation;
        document.getElementById('panel-text').innerText = info.text;
        document.getElementById('panel-placeholder').style.display = 'none';
        document.getElementById('panel-body').style.display = 'block';
    }}

    function clearPanel() {{
        document.getElementById('panel-placeholder').style.display = 'block';
        document.getElementById('panel-body').style.display = 'none';
    }}

    // Wire up hover events after vis.js network is ready
    window.addEventListener('load', function() {{
        network.setOptions({{ interaction: {{ hover: true }} }});
        network.on('hoverNode', function(e) {{ showPanel(e.node); }});
        network.on('blurNode', function() {{ clearPanel(); }});
    }});

    function nextTurn() {{
        currentDepth++;
        if (currentDepth > maxDepth) {{
            document.getElementById('turn-display').innerText = "All nodes revealed!";
            return;
        }}

        var nodesDS = network.body.data.nodes;
        var edgesDS = network.body.data.edges;

        // Reveal nodes at this depth
        var toReveal = nodesByDepth[currentDepth] || [];
        toReveal.forEach(function(id) {{
            nodesDS.update({{id: id, hidden: false}});
        }});

        // Reveal edges where both endpoints are now visible
        var edgesToReveal = edgesByDepth[String(currentDepth)] || [];
        edgesToReveal.forEach(function(pair) {{
            var fromNode = nodesDS.get(pair[0]);
            var toNode = nodesDS.get(pair[1]);
            if (fromNode && toNode && !fromNode.hidden && !toNode.hidden) {{
                network.body.data.edges.get().forEach(function(e) {{
                    if ((e.from === pair[0] && e.to === pair[1]) ||
                        (e.from === pair[1] && e.to === pair[0])) {{
                        edgesDS.update({{id: e.id, hidden: false}});
                    }}
                }});
            }}
        }});

        var label = currentDepth === 0
            ? "Depth 0 — Seed agents"
            : "Depth " + currentDepth + " — Wave " + currentDepth;
        document.getElementById('turn-display').innerText = label;
        document.getElementById('next-btn').innerText =
            currentDepth >= maxDepth ? "Done" : "Next Wave ▶";
    }}
    """

    net.write_html("interactive_spread.html")

    with open("interactive_spread.html", "r") as f:
        html = f.read()

    # Shrink the graph canvas to leave room for the side panel
    html = html.replace('width="100%"', 'width="calc(100% - 360px)"')
    html = html.replace("width: 100%;", "width: calc(100% - 360px);")

    side_panel = (
        '<div style="position:fixed;top:0;right:0;width:350px;height:100vh;'
        'background:#0f0f1e;border-left:1px solid #333;z-index:1000;'
        'display:flex;flex-direction:column;font-family:sans-serif;">'

        # Header
        '<div style="padding:14px 16px;border-bottom:1px solid #333;flex-shrink:0;">'
        '<div style="color:#ccc;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Agent Response</div>'

        # Placeholder
        '<div id="panel-placeholder" style="color:#555;font-size:13px;padding:20px 0;">'
        'Hover a node to read its response</div>'

        # Agent header (hidden until hover)
        '<div id="panel-body" style="display:none;">'
        '<div id="panel-name" style="color:#fff;font-size:15px;font-weight:bold;margin-bottom:6px;"></div>'
        '<div id="panel-meta" style="font-size:12px;color:#aaa;"></div>'
        '</div></div>'

        # Scrollable text body
        '<div id="panel-text" style="flex:1;overflow-y:auto;padding:16px;'
        'color:#ddd;font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;">'
        '</div></div>'
    )

    controls = (
        '<div style="position:fixed;top:14px;left:14px;z-index:999;'
        'background:#1a1a2e;border:1px solid #444;padding:12px 16px;border-radius:8px;">'
        '<button id="next-btn" onclick="nextTurn()" '
        'style="background:#fdbb2d;color:#1a1a2e;border:none;padding:8px 18px;'
        'font-size:14px;font-weight:bold;border-radius:5px;cursor:pointer;">Reveal Depth 0 ▶</button>'
        '<div id="turn-display" style="margin-top:8px;color:#ccc;font-size:13px;">Click to start</div>'
        '<div style="margin-top:10px;font-size:11px;color:#888;">'
        '<span style="color:#fdbb2d;">■</span> Seeds &nbsp;'
        '<span style="color:#e74c3c;">■</span> Wave 1 &nbsp;'
        '<span style="color:#2ecc71;">■</span> Wave 2 &nbsp;'
        '<span style="color:#3498db;">■</span> Wave 3</div>'
        f'</div>{side_panel}<script>{step_js}</script>'
    )

    with open("interactive_spread.html", "w") as f:
        f.write(html.replace("<body>", "<body>" + controls))

    print("✨ Open 'interactive_spread.html' and click the button to step through the BFS spread.")


if __name__ == "__main__":
    create_stepped_visualization()
