import {
  DocumentNode,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  InlineFragmentNode,
  ASTVisitor,
  ASTNode,
  visit,
  Kind,
} from "graphql";

type FragmentName = string;
type FragmentNameToNode = Map<FragmentName, FragmentDefinitionNode>;

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
function inlineFragments(
  node: FragmentSpreadNode,
  fragmentNameToNode: FragmentNameToNode,
  queryFileName: string
): InlineFragmentNode {
  const fragmentDefinition = fragmentNameToNode.get(node.name.value);
  if (fragmentDefinition === undefined) {
    const fragmentNames = [...fragmentNameToNode.keys()];
    throw new Error(
      `fragment '${
        node.name.value
      }' definition not found while processing '${queryFileName}'; ${
        fragmentNames.length
      } fragments found:\n\t${fragmentNames.join("\n\t")}`
    );
  }

  const result: InlineFragmentNode = {
    kind: Kind.INLINE_FRAGMENT,
    typeCondition: {
      kind: Kind.NAMED_TYPE,
      name: {
        kind: Kind.NAME,
        value: fragmentDefinition.typeCondition.name.value,
      },
    },
    selectionSet: fragmentDefinition.selectionSet,
  };

  return result;
}

interface ReplacedPath {
  key: string | number | undefined;
  parent: ASTNode | readonly ASTNode[] | undefined;
}

type FragmentInliningVisitor = ASTVisitor & {
  _fragmentSpreadStack: string[];
  _replacedPaths: ReplacedPath[];
};

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
export function inlineAllFragments(
  graphqlDocument: DocumentNode,
  queryFileName: string
): DocumentNode {
  const fragmentNameToNode: FragmentNameToNode = new Map();

  // first pass, collection fragment definitions
  visit(graphqlDocument, {
    FragmentDefinition(node) {
      // http://spec.graphql.org/June2018/#sec-Fragment-Name-Uniqueness
      if (fragmentNameToNode.has(node.name.value)) {
        throw new Error(
          `Invalid GraphQL query file: "${queryFileName}" -- Fragment ${node.name.value} defined more than once`
        );
      }
      fragmentNameToNode.set(node.name.value, node);
    },
  });

  // second pass, inline fragments in queries and delete definitions
  const visitor: FragmentInliningVisitor = {
    _fragmentSpreadStack: [],
    _replacedPaths: [],

    FragmentSpread: {
      enter(this: FragmentInliningVisitor, node, key, parent) {
        if (this._fragmentSpreadStack.includes(node.name.value)) {
          throw new Error(
            `Invalid GraphQL query file "${queryFileName}" - Cyclic fragment spread: ${this._fragmentSpreadStack.join(
              " → "
            )} → ${node.name.value}`
          );
        }
        this._fragmentSpreadStack.push(node.name.value);
        const result = inlineFragments(node, fragmentNameToNode, queryFileName);
        this._replacedPaths.push({ key, parent });
        return result;
      },
    },

    InlineFragment: {
      leave(this: FragmentInliningVisitor, _node, key, parent) {
        if (this._replacedPaths.length === 0) {
          // no replacement has been done, nothing to do on the leave of an InlineFragment
          return;
        }
        const { key: replacedKey, parent: replacedParent } =
          this._replacedPaths[this._replacedPaths.length - 1];
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
      },
    },
  };
  const doc = visit(graphqlDocument, visitor);

  return doc;
}
