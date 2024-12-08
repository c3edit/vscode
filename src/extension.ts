// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

type DocumentID = string;

// Global variable to store the process handle
let backendProcess: ChildProcess | undefined;
// Global variable to store the document currently being created on the backend.
let currentlyCreatingDocument: vscode.TextEditor | undefined;
// Global variable to track editors with active documents.
const activeDocuments: Map<vscode.TextEditor, DocumentID> = new Map();

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext): void {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "c3edit" is now active!');

  // Retrieve the backend path from the configuration
  const backendPath = vscode.workspace.getConfiguration().get<string>('c3edit.backendPath', '');
  console.log(`Backend path: ${backendPath}`);
  
  // Register a new command to run the backend binary
  context.subscriptions.push(
    vscode.commands.registerCommand('c3edit.runBackend', () => {
	  if (backendPath) {
        backendProcess = spawn(backendPath);

        backendProcess.stdout!.on('data', processBackendMessage);

        backendProcess.stderr!.on('data', (data) => {
          vscode.window.showErrorMessage(`Backend error: ${data}`);
        });

        backendProcess.on('error', (error) => {
          vscode.window.showErrorMessage(`Error executing backend: ${error.message}`);
        });

        backendProcess.on('close', (code) => {
          vscode.window.showInformationMessage(`Backend process exited with code ${code}`);
        });

        backendProcess.on('spawn', () => {
          vscode.window.showInformationMessage(`Backend process successfully running!`);
        })
	  } else {
	    vscode.window.showErrorMessage('Backend path is not set. Please configure it in the settings.');
	  }
    }));

  context.subscriptions.push(
    vscode.commands.registerCommand('c3edit.createDocument', createDocument)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('c3edit.connectToPeer', connectToPeer)
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(onDidChangeTextEditorSelection)
  );
}

function getAbsoluteIndex(document: vscode.TextDocument, position: vscode.Position): number {
  let absoluteIndex = 0;

  // Sum the lengths of all lines before the current line
  for (let i = 0; i < position.line; i++) {
    absoluteIndex += document.lineAt(i).text.length + 1; // +1 for the newline character
  }

  // Add the character index of the position within its line
  absoluteIndex += position.character;

  return absoluteIndex;
}

export function deactivate(): void {
  // Terminate the backend process if it's running
  if (backendProcess) {
    backendProcess.kill();
  }
}

function onDidChangeTextEditorSelection(e: vscode.TextEditorSelectionChangeEvent): void {
  const editor = e.textEditor;
  const id = activeDocuments.get(editor);
  if (!id) {
    return;
  }
  
  const cursor = editor.selection.active;
  const point = getAbsoluteIndex(editor.document, cursor)

  sendMessageToBackend("set_cursor", {document_id: id, location: point});
}

function ensureBackendProcessActive(): boolean {
  if (!backendProcess) {
    vscode.window.showErrorMessage('Backend process is not active.');
    return false;
  }
  
  return true;
}

function createDocument(): void {
  if (!ensureBackendProcessActive()) {
    return;
  }
  
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    currentlyCreatingDocument = activeEditor;
    const name = path.basename(activeEditor.document.fileName);
    const initialContent = activeEditor.document.getText();
    sendMessageToBackend("create_document", {
      name,
      initial_content: initialContent,
    });
  } else {
    vscode.window.showInformationMessage('No active editor window found.');
  }
}

async function connectToPeer(): Promise<void> {
  if (!ensureBackendProcessActive()) {
    return;
  }

  const peerAddress = await vscode.window.showInputBox({
    prompt: 'Enter the peer address (IP:Port)',
    placeHolder: 'e.g., 192.168.1.1:8080'
  });

  if (peerAddress) {
    sendMessageToBackend("add_peer", { address: peerAddress });
    vscode.window.showInformationMessage(`Connecting to peer at ${peerAddress}…`);
  } else {
    vscode.window.showInformationMessage('No peer address provided.');
  }
}


function processBackendMessage(data: Buffer): void {
  try {
    const message = JSON.parse(data.toString());
    switch (message.type) {
      case 'create_document_response':
        if (currentlyCreatingDocument) {
          vscode.window.showInformationMessage(`Document created with ID ${message.id}.`);
          
          activeDocuments.set(currentlyCreatingDocument, message.id);
          currentlyCreatingDocument = undefined;
        } else {
          console.warn('No document was being created when response was received.');
        }
        break;
      case 'add_peer_response':
        vscode.window.showInformationMessage(`Successfully added peer at ${message.address}`)
        break;
      default:
        console.warn('Unknown message:', JSON.stringify(message));
        break;
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to parse backend message: ${error.message}`);
  }
}

function sendMessageToBackend(type: string, json: object): void {
  if (!ensureBackendProcessActive()) {
    return;
  }

  const text = JSON.stringify({
    type,
    ...json
  });
  backendProcess!.stdin!.write(text + '\n');
}
