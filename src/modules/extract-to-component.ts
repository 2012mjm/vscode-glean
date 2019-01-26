import { activeEditor, selectedText } from "../editor";

import { showDirectoryPicker } from "../directories-picker";

import { showFilePicker } from "../file-picker";
import * as path from 'path'
import { importReactIfNeeded } from "./jsx";

import { appendSelectedTextToFile, prependImportsToFileIfNeeded, replaceSelectionWith, switchToDestinationFileIfRequired, handleError, ProcessedSelection } from "../code-actions";
import * as t from "@babel/types";
import { persistFileSystemChanges } from "../file-system";
import { jsxToAst } from "../parsing";
import { capitalizeFirstLetter } from "../utils";
import { transformFromAst } from "@babel/core";
import traverse from "@babel/traverse";
import { buildComponent } from "./component-builder";

function produceComponentNameFrom(fullPath: any) {
  const baseName = path.basename(fullPath, path.extname(fullPath));
  return baseName
    .split("-")
    .map(capitalizeFirstLetter)
    .join("");
}


export function wrapWithComponent(fullPath, jsx): ProcessedSelection {
  const componentProperties = {
    argumentProps: new Set(),
    memberProps: new Set(),
    state: new Set(),
    componentMembers: new Set()
  };

  const visitor = {
    Identifier(path) {
      let isMember =
        !!path.findParent(
          parentPath =>
            t.isMemberExpression(parentPath.node) ||
            path.isArrowFunctionExpression(parentPath.node)
        ) || t.isObjectProperty(path.parent);
      if (!isMember && !path.node.wasVisited) {
        componentProperties.argumentProps.add(path.node.name);
      }
    },
    MemberExpression(path) {
      if (!path.node.wasVisited) {
        if (
          t.isThisExpression(path.node.object.object) &&
          (path.node.object.property.name === "props" ||
          path.node.object.property.name === "state")
        ) {
          //props or state = path.node.property.name;
          if (path.node.object.property.name === "props") {
            componentProperties.memberProps.add(path.node.property.name);
          } else {
            path.node.object.property.name = "props";
            componentProperties.state.add(path.node.property.name);
          }
        } else {
            componentProperties.componentMembers.add(path.node.property.name);
        }
        path.node.wasVisited = true;
        path.replaceWith(t.identifier(path.node.property.name));
        path.skip();
      }
    }
  };

  const ast = jsxToAst(jsx);

  traverse(ast, visitor);

  const processedJSX = transformFromAst(ast).code;
  const indexOfLastSemicolon = processedJSX.lastIndexOf(";");
  const code =
    processedJSX.slice(0, indexOfLastSemicolon) +
    processedJSX.slice(indexOfLastSemicolon + 1);
  const componentName = produceComponentNameFrom(fullPath);

  return {
    text: buildComponent(componentName, code, componentProperties),
    metadata: {
      isJSX: true,
      componentProperties,
      name: componentName
    }
  };
}

export function createComponentInstance(name, props) {
  const stateToInputProps = Array.from(props.state)
    .map(prop => `${prop}={this.state.${prop}}`)
    .join(" ");
  const argPropsToInputProps = Array.from(props.argumentProps)
    .map(prop => `${prop}={${prop}}`)
    .join(" ");
  const memberPropsToInputProps = Array.from(props.memberProps)
    .map(prop => `${prop}={this.props.${prop}}`)
    .join(" ");
  const componentMembersToInputProps = Array.from(props.componentMembers)
    .map(prop => `${prop}={this.${prop}}`)
    .join(" ");

  return `<${name}  ${stateToInputProps} ${argPropsToInputProps} ${memberPropsToInputProps} ${componentMembersToInputProps}/>`;
}


export async function extractJSXToComponent() {
  var editor = activeEditor();
  if (!editor) {
    return; // No open text editor
  }

  try {
    const folderPath = await showDirectoryPicker()
    const filePath = await showFilePicker(folderPath);

    const selectionProccessingResult = await wrapWithComponent(filePath, selectedText());
    await appendSelectedTextToFile(selectionProccessingResult, filePath);
    await importReactIfNeeded(filePath);
    await prependImportsToFileIfNeeded(selectionProccessingResult, filePath);
    const componentInstance = createComponentInstance(selectionProccessingResult.metadata.name, selectionProccessingResult.metadata.componentProperties);
    await persistFileSystemChanges(replaceSelectionWith(componentInstance));
    await switchToDestinationFileIfRequired(filePath);
  } catch (e) {
    handleError(e);
  }
}
