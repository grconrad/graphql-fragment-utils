"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graphql_1 = require("graphql");
const example_query_1 = require("./example-query");
function logFragmentDefNodes(fragmentDefNodes) {
    console.log(`fragment definitions -->
${fragmentDefNodes.map((def) => (0, graphql_1.print)(def))}
`);
}
const queryDoc = (0, graphql_1.parse)(example_query_1.QUERY);
console.log(`
print -->
${(0, graphql_1.print)(queryDoc)}
`);
// First, find fragment definitions
// Simple way: filter definitions
// But this gives us only an array
const fragmentDefs1 = queryDoc.definitions.filter((def) => def.kind === graphql_1.Kind.FRAGMENT_DEFINITION);
logFragmentDefNodes(fragmentDefs1);
const fragmentNameToDef1 = fragmentDefs1.reduce((acc, fragmentDefNode) => {
    acc.set(fragmentDefNode.name.value, fragmentDefNode);
    return acc;
}, new Map());
// Map fragment names to definitions
const fragmentNameToDef2 = new Map();
// In first pass, find fragment definitions
(0, graphql_1.visit)(queryDoc, {
    FragmentDefinition(node) {
        // http://spec.graphql.org/June2018/#sec-Fragment-Name-Uniqueness
        const fragmentName = node.name.value;
        if (fragmentNameToDef2.has(fragmentName)) {
            throw new Error(`Invalid GraphQL query -- fragment ${node.name.value} is defined more than once`);
        }
        fragmentNameToDef2.set(node.name.value, node);
    },
});
// In second pass, find fragment spreads and replace with something simple
const modifiedQueryDoc = (0, graphql_1.visit)(queryDoc, {
    FragmentSpread: {
        enter(node) {
            const fragmentName = node.name.value;
            if (!fragmentNameToDef2.has(fragmentName)) {
                throw new Error(`Invalid fragment spread ...${fragmentName} -- fragment ${node.name.value} is not defined`);
            }
            console.log(`Replacing ...${fragmentName} with foo`);
            return {
                kind: graphql_1.Kind.FIELD,
                name: {
                    kind: graphql_1.Kind.NAME,
                    value: "foo",
                },
            };
        },
    },
});
console.log(`
Modified -->
${(0, graphql_1.print)(modifiedQueryDoc)}
`);
/** A build-as-we-go cache to store the result of exploding fragments */
const _explodedFragmentCache = new Map();
// Come back to this later
function fullyExpandFragmentDefinition(fragmentDef) {
    const fragmentName = fragmentDef.name.value;
    let explodedSelectionNodes;
    if (_explodedFragmentCache.has(fragmentName)) {
        explodedSelectionNodes = _explodedFragmentCache.get(fragmentName);
    }
    else {
        // Visit all selection sets inside the fragment definition, searching for
        // fragment spreads and recursing on those fragments
        const explodedFragmentDef = (0, graphql_1.visit)(fragmentDef, {
            SelectionSet: {
                enter(node) {
                    let shouldReplace = false;
                    const replacementSelections = [];
                    for (let i = 0; i < node.selections.length; i++) {
                        const selectionNode = node.selections[i];
                        if (selectionNode.kind === graphql_1.Kind.FRAGMENT_SPREAD) {
                            // shouldReplace = true;
                            const fragmentSpreadNode = selectionNode;
                            const fragmentName = fragmentSpreadNode.name.value;
                            const fragmentDef = fragmentNameToDef1.get(fragmentName);
                            replacementSelections.push(...fullyExpandFragmentDefinition(fragmentDef));
                        }
                        else {
                            replacementSelections.push(selectionNode);
                        }
                    }
                    // If we found a fragment spread, swap SelectionSetNode we're visiting
                    // for a new one where the target fragment's contents have been exploded
                    // (one level deep).
                    if (shouldReplace) {
                        return {
                            kind: graphql_1.Kind.SELECTION_SET,
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
