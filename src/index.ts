import {
  FieldNode,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  Kind,
  parse,
  print,
  SelectionNode,
  SelectionSetNode,
  visit,
} from "graphql";

import { QUERY } from "./example-query";

function logFragmentDefNodes(fragmentDefNodes: FragmentDefinitionNode[]) {
  console.log(`fragment definitions -->
${fragmentDefNodes.map((def) => print(def))}
`);
}

const queryDoc = parse(QUERY);
console.log(`
print -->
${print(queryDoc)}
`);

// First, find fragment definitions

// Simple way: filter definitions
// But this gives us only an array
const fragmentDefs1 = queryDoc.definitions.filter(
  (def) => def.kind === Kind.FRAGMENT_DEFINITION
) as FragmentDefinitionNode[];
logFragmentDefNodes(fragmentDefs1);

const fragmentNameToDef1 = fragmentDefs1.reduce((acc, fragmentDefNode) => {
  acc.set(fragmentDefNode.name.value, fragmentDefNode);
  return acc;
}, new Map<string, FragmentDefinitionNode>());

// Map fragment names to definitions
const fragmentNameToDef2 = new Map<string, FragmentDefinitionNode>();

// In first pass, find fragment definitions
visit(queryDoc, {
  FragmentDefinition(node) {
    // http://spec.graphql.org/June2018/#sec-Fragment-Name-Uniqueness
    const fragmentName = node.name.value;
    if (fragmentNameToDef2.has(fragmentName)) {
      throw new Error(
        `Invalid GraphQL query -- fragment ${node.name.value} is defined more than once`
      );
    }
    fragmentNameToDef2.set(node.name.value, node);
  },
});

// In second pass, find fragment spreads and replace with something simple
const modifiedQueryDoc = visit(queryDoc, {
  FragmentSpread: {
    enter(node) {
      const fragmentName = node.name.value;
      if (!fragmentNameToDef2.has(fragmentName)) {
        throw new Error(
          `Invalid fragment spread ...${fragmentName} -- fragment ${node.name.value} is not defined`
        );
      }
      console.log(`Replacing ...${fragmentName} with foo`);
      return {
        kind: Kind.FIELD,
        name: {
          kind: Kind.NAME,
          value: "foo",
        },
      };
    },
  },
});
console.log(`
Modified -->
${print(modifiedQueryDoc)}
`);

/** A build-as-we-go cache to store the result of exploding fragments */
const _explodedFragmentCache = new Map<string, Readonly<SelectionNode[]>>();

// Come back to this later
function fullyExpandFragmentDefinition(
  fragmentDef: FragmentDefinitionNode
): Readonly<SelectionNode[]> {
  const fragmentName = fragmentDef.name.value;
  let explodedSelectionNodes: Readonly<SelectionNode[]>;
  if (_explodedFragmentCache.has(fragmentName)) {
    explodedSelectionNodes = _explodedFragmentCache.get(fragmentName)!;
  } else {
    // Visit all selection sets inside the fragment definition, searching for
    // fragment spreads and recursing on those fragments
    const explodedFragmentDef = visit(fragmentDef, {
      SelectionSet: {
        enter(node) {
          let shouldReplace = false;
          const replacementSelections: SelectionNode[] = [];
          for (let i = 0; i < node.selections.length; i++) {
            const selectionNode = node.selections[i];
            if (selectionNode.kind === Kind.FRAGMENT_SPREAD) {
              // shouldReplace = true;
              const fragmentSpreadNode = selectionNode as FragmentSpreadNode;
              const fragmentName = fragmentSpreadNode.name.value;
              const fragmentDef = fragmentNameToDef1.get(fragmentName)!;
              replacementSelections.push(
                ...fullyExpandFragmentDefinition(fragmentDef)
              );
            } else {
              replacementSelections.push(selectionNode);
            }
          }
          // If we found a fragment spread, swap SelectionSetNode we're visiting
          // for a new one where the target fragment's contents have been exploded
          // (one level deep).
          if (shouldReplace) {
            return {
              kind: Kind.SELECTION_SET,
              selections: replacementSelections,
            };
          }
        },
        // Find every direct child node that is a FragmentSpread
        // Recurse on that defined fragment's definition
      },
    });
    explodedSelectionNodes = explodedFragmentDef.selectionSet.selections;
    _explodedFragmentCache.set(fragmentName, explodedSelectionNodes);
  }
  return explodedSelectionNodes;
}
