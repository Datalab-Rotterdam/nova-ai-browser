import { mount } from 'svelte';
import '@vscode/codicons/dist/codicon.css';
import '../lib/theme.scss';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
