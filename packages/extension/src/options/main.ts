import { mount } from 'svelte';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '@vscode/codicons/dist/codicon.css';
import '../lib/theme.scss';
import './theme.scss';
import Options from './Options.svelte';

mount(Options, { target: document.getElementById('app')! });
