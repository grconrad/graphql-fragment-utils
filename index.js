"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
exports.__esModule = true;
exports.inlineAllFragments = void 0;
var graphql_1 = require("graphql");
/**
 * Shallow-inlines fragment spreads with the selection set from the fragment
 * definition.
 *
 * Being a shallow inline, this function expects to be run in the enter phase
 * of a visitor, so that the replacement is also visited.
 *
 * @param {FragmentSpreadNode} node - The GraphQL FragmentSpreadNode to be
 * replaced with a shallow InlineFragmentNode whose selection set matches the
 * fragment definition of `node`
 *
 * @param {Map<string,FragmentDefinitionNode>} fragmentNameToNode - A complete
 * map of fragment name, definition node pairs from a prior pass of the parent
 * document.
 *
 * @param {string} queryFileName - The name of the .graphql file.  Used only in
 * error messages.
 *
 * @return {InlineFragmentNode} - An inline fragment node whose selection set
 * and type condition are pulled from `fragmentNameToNode` for the fragment
 * named in `node`.
 */
function inlineFragments(node, fragmentNameToNode, queryFileName) {
    var fragmentDefinition = fragmentNameToNode.get(node.name.value);
    if (fragmentDefinition === undefined) {
        var fragmentNames = __spreadArray([], fragmentNameToNode.keys(), true);
        throw new Error("fragment '".concat(node.name.value, "' definition not found while processing '").concat(queryFileName, "'; ").concat(fragmentNames.length, " fragments found:\n\t").concat(fragmentNames.join("\n\t")));
    }
    var result = {
        kind: "InlineFragment",
        typeCondition: {
            kind: "NamedType",
            name: {
                kind: "Name",
                value: fragmentDefinition.typeCondition.name.value
            }
        },
        selectionSet: fragmentDefinition.selectionSet
    };
    return result;
}
/**
 * Inlines all fragment spreads in a parsed GraphQL document, replacing them
 * with inline fragments.  The end result is an equivalent GraphQL document
 * that has no fragment spreads, but may have inline fragments
 *
 * @param {DocumentNode} graphqlDocument - The parsed GraphQL document whose
 * fragment definitions should be inlined.
 *
 * @param {string} queryFileName - The name of the .graphql file.  Used only in
 * error messages.
 *
 * @return {DocumentNode} - A new GraphQL document that is equivalent to
 * `graphqlDocument`, but with fragment spreads inlined.
 */
function inlineAllFragments(graphqlDocument, queryFileName) {
    var fragmentNameToNode = new Map();
    // first pass, collection fragment definitions
    (0, graphql_1.visit)(graphqlDocument, {
        FragmentDefinition: function (node) {
            // http://spec.graphql.org/June2018/#sec-Fragment-Name-Uniqueness
            if (fragmentNameToNode.has(node.name.value)) {
                throw new Error("Invalid GraphQL query file: \"".concat(queryFileName, "\" -- Fragment ").concat(node.name.value, " defined more than once"));
            }
            fragmentNameToNode.set(node.name.value, node);
        }
    });
    // second pass, inline fragments in queries and delete definitions
    var visitor = {
        _fragmentSpreadStack: [],
        _replacedPaths: [],
        FragmentSpread: {
            enter: function (node, key, parent) {
                if (this._fragmentSpreadStack.includes(node.name.value)) {
                    throw new Error("Invalid GraphQL query file \"".concat(queryFileName, "\" - Cyclic fragment spread: ").concat(this._fragmentSpreadStack.join(" → "), " \u2192 ").concat(node.name.value));
                }
                this._fragmentSpreadStack.push(node.name.value);
                var result = inlineFragments(node, fragmentNameToNode, queryFileName);
                this._replacedPaths.push({ key: key, parent: parent });
                return result;
            }
        },
        InlineFragment: {
            leave: function (_node, key, parent) {
                if (this._replacedPaths.length === 0) {
                    // no replacement has been done, nothing to do on the leave of an InlineFragment
                    return;
                }
                var _a = this._replacedPaths[this._replacedPaths.length - 1], replacedKey = _a.key, replacedParent = _a.parent;
                if (replacedKey === key && replacedParent === parent) {
                    // We push onto the stack in FragmentSpread, but:
                    //  a. we only do a shallow replacement, so we must mutate the node
                    //    on `enter` and not `leave` so we visit our newly created node
                    //  b. because we mutate on `enter` we never leave that node: instead
                    //    we'll leave our newly created `InlineFragment` node, so we pop
                    //    here instead. The path to the InlineFragment is tracked to distinguish
                    //    between InlineFragments from the query itself and InlineFragments, which
                    //    are the result of replacing a FragmentSpread with an InlineFragment
                    this._fragmentSpreadStack.pop();
                    this._replacedPaths.pop();
                }
            }
        }
    };
    var doc = (0, graphql_1.visit)(graphqlDocument, visitor);
    return doc;
}
exports.inlineAllFragments = inlineAllFragments;
