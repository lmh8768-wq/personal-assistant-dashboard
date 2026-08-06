// Shared pure tree logic for practice.js's 연습 커리큘럼 and study.js's 학업
// 목표 trees — both are the exact same {id, label, done, children} shape, and
// this used to be hand-copied into each file under different names
// (findGoalNode/findNode, countGoalProgress/countProgress, etc.). Any fix to
// one copy had to be manually re-applied to the other or the two trees
// silently diverged. Each file still keeps its own locally-named wrapper
// (findGoalNode, findParentIdIn, ...) so every existing call site is
// unchanged — only the implementation underneath is now shared.
(function () {
  function findNode(list, id) {
    for (const node of list) {
      if (node.id === id) return node;
      const found = findNode(node.children || [], id);
      if (found) return found;
    }
    return null;
  }

  // Removes the node with `id` from `list` (searching recursively) and
  // returns it so the caller can offer undo.
  function extractNode(list, id) {
    const idx = list.findIndex((n) => n.id === id);
    if (idx !== -1) {
      const [node] = list.splice(idx, 1);
      return node;
    }
    for (const node of list) {
      const found = extractNode(node.children || [], id);
      if (found) return found;
    }
    return null;
  }

  function setDoneRecursive(node, done) {
    node.done = done;
    (node.children || []).forEach((child) => setDoneRecursive(child, done));
  }

  function findParentId(list, childId) {
    function search(nodes, parentId) {
      for (const n of nodes) {
        if (n.id === childId) return parentId;
        const found = search(n.children || [], n.id);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    const found = search(list, null);
    return found === undefined ? null : found;
  }

  // Re-derives `done` for a node from its children (done only if it HAS
  // children and every one of them is done), then walks up doing the same
  // for each ancestor. Used whenever a subtree's completeness could have
  // changed out from under an ancestor: a toggle, a new incomplete child, a
  // removed/restored child.
  function recomputeNodeAndAncestors(list, nodeId) {
    // A single O(N) descent that captures a direct reference to every
    // ancestor along the way, instead of the old approach of re-searching
    // the WHOLE tree from the root once per ancestor level (one findNode
    // AND one findParentId walk each) — O(D·N) for a chain D levels deep
    // is now one O(N) walk down plus a plain O(D) walk back up the
    // already-captured path.
    function findPathToNode(nodes) {
      for (const node of nodes) {
        if (node.id === nodeId) return [node];
        const childPath = findPathToNode(node.children || []);
        if (childPath) return [...childPath, node];
      }
      return null;
    }
    const path = findPathToNode(list); // [target, parent, grandparent, ...]
    if (!path) return;
    path.forEach((node) => {
      const kids = node.children || [];
      if (kids.length > 0) {
        node.done = kids.every((c) => c.done);
      } else if (node.done) {
        // This node just lost its last child (this function is only ever
        // entered from a structural change — see callers). Its `done` was
        // a derived aggregate of children that no longer exist, not
        // something the user actually checked off as a standalone item —
        // leaving it `true` here would render it as a directly-togglable,
        // already-checked leaf despite nobody having completed anything.
        node.done = false;
      }
    });
  }

  // Counts only LEAF goals as actual tasks — a parent's own `done` is always
  // fully derived from its children (never independently set), not a real
  // extra unit of work, but a naive count used to add +1 to total (and +1 to
  // done when the parent happened to be fully done) for every ancestor level
  // on top of its leaves. That biased the displayed percentage toward "not
  // yet fully done" the deeper a tree went: e.g. root with children A (both
  // of A's 2 leaves done, so A itself reads done) and B (1 of 2 leaves done)
  // is 3/4 = 75% real leaf completion, but a naive count would compute
  // 4/7 ≈ 57% by also counting A, B, and the root as extra not-really-tasks.
  function countProgress(node) {
    const kids = node.children || [];
    if (kids.length === 0) {
      return { total: 1, done: node.done ? 1 : 0 };
    }
    let total = 0;
    let done = 0;
    kids.forEach((child) => {
      const c = countProgress(child);
      total += c.total;
      done += c.done;
    });
    return { total, done };
  }

  // Copies get fresh ids top to bottom so a pasted subtree never collides
  // with the goal(s) it was copied from (or with itself, pasted twice).
  // `idPrefix` keeps each tree's id namespace distinct ("curr" for practice
  // curriculum goals, "goal" for study goals) the same way it always was.
  function deepCloneWithNewIds(node, idPrefix, createId) {
    return {
      id: createId(idPrefix),
      label: node.label,
      done: !!node.done,
      children: (node.children || []).map((child) => deepCloneWithNewIds(child, idPrefix, createId)),
    };
  }

  window.GoalTreeLogic = {
    findNode,
    extractNode,
    setDoneRecursive,
    findParentId,
    recomputeNodeAndAncestors,
    countProgress,
    deepCloneWithNewIds,
  };
})();
