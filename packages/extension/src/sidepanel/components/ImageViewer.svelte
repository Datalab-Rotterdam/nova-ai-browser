<script lang="ts">
    // nova-ai-vscode's ImageViewer.svelte, plus zoom: screenshots in the narrow panel need a close look.
    import { tick } from 'svelte';
    import { closeImage, viewer } from '../viewer.svelte';

    const MAX_ZOOM = 16;
    const STEP = 1.5;

    /** 1 fits the image to the panel's width. */
    let zoom = $state(1);
    let stage: HTMLElement | undefined = $state();
    let img: HTMLImageElement | undefined = $state();
    let closeButton: HTMLButtonElement | undefined = $state();
    let drag: { x: number; y: number; moved: boolean; onBackdrop: boolean } | undefined;

    $effect(() => {
        if (viewer.image) {
            zoom = 1;
            void tick().then(() => closeButton?.focus());
        }
    });

    /**
     * Zooms keeping the image point under the screen point (x, y) where it is (default: the
     * stage's center). Measured on the image itself: a small image is centered with margins.
     */
    async function zoomTo(next: number, x?: number, y?: number) {
        if (!stage || !img) return;
        const box = stage.getBoundingClientRect();
        const px = x ?? box.left + box.width / 2;
        const py = y ?? box.top + box.height / 2;
        const before = img.getBoundingClientRect();
        const fx = (px - before.left) / before.width;
        const fy = (py - before.top) / before.height;
        zoom = Math.min(MAX_ZOOM, Math.max(1, next));
        await tick();
        const after = img.getBoundingClientRect();
        stage.scrollLeft += after.left + fx * after.width - px;
        stage.scrollTop += after.top + fy * after.height - py;
    }

    function onWheel(event: WheelEvent) {
        // Trackpad pinches arrive as wheel events with ctrlKey; plain scrolling pans.
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        void zoomTo(zoom * Math.exp(-event.deltaY / 200), event.clientX, event.clientY);
    }

    function onPointerDown(event: PointerEvent) {
        if (event.button !== 0) return;
        // Pointer capture retargets later events to the stage, so note now where the press began.
        drag = { x: event.clientX, y: event.clientY, moved: false, onBackdrop: event.target === stage };
        stage?.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
        if (!drag || !stage) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        stage.scrollLeft -= dx;
        stage.scrollTop -= dy;
        drag.x = event.clientX;
        drag.y = event.clientY;
    }

    function onPointerUp() {
        const backdropClick = drag?.onBackdrop && !drag.moved;
        drag = undefined;
        // A click on the backdrop around the image closes, like nova-ai-vscode's viewer.
        if (backdropClick) closeImage();
    }

    function onKeydown(event: KeyboardEvent) {
        if (!viewer.image) return;
        const actions: Record<string, () => void> = {
            Escape: closeImage,
            '+': () => void zoomTo(zoom * STEP),
            '=': () => void zoomTo(zoom * STEP),
            '-': () => void zoomTo(zoom / STEP),
            '0': () => void zoomTo(1)
        };
        const action = actions[event.key];
        if (action) {
            event.preventDefault();
            action();
        }
    }
</script>

<svelte:window onkeydown={onKeydown} />

{#if viewer.image}
    <div class="overlay" role="dialog" aria-modal="true" aria-label={viewer.image.name}>
        <div class="toolbar">
            <button class="nova-icon-button codicon codicon-zoom-out" type="button" aria-label="Zoom out" title="Zoom out (-)" disabled={zoom <= 1} onclick={() => zoomTo(zoom / STEP)}></button>
            <span class="level" aria-live="polite">{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×</span>
            <button class="nova-icon-button codicon codicon-zoom-in" type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={zoom >= MAX_ZOOM} onclick={() => zoomTo(zoom * STEP)}></button>
            <button class="nova-icon-button codicon codicon-screen-normal" type="button" aria-label="Fit to width" title="Fit to width (0)" disabled={zoom === 1} onclick={() => zoomTo(1)}></button>
            <span class="name">{viewer.image.name}</span>
            <button class="nova-icon-button codicon codicon-close" type="button" aria-label="Close image" title="Close (Esc)" bind:this={closeButton} onclick={closeImage}></button>
        </div>
        <!-- Pointer and wheel handlers are for mouse and trackpad; the toolbar and keys do the same. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
        <div
            class="stage"
            class:zoomed={zoom > 1}
            tabindex="0"
            bind:this={stage}
            onwheel={onWheel}
            onpointerdown={onPointerDown}
            onpointermove={onPointerMove}
            onpointerup={onPointerUp}
            onpointercancel={() => (drag = undefined)}
        >
            <img
                src={viewer.image.src}
                alt={viewer.image.name}
                style:width={`${zoom * 100}%`}
                draggable="false"
                bind:this={img}
                ondblclick={(event) => zoomTo(zoom > 1 ? 1 : 3, event.clientX, event.clientY)}
            />
        </div>
    </div>
{/if}

<style lang="scss">
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    /* Nearly opaque: the panel behind it should not show through while looking at details. */
    background: rgb(16 16 16 / 0.97);
  }

  .toolbar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
    color: #fff;

    .nova-icon-button {
      color: #fff;

      &:hover:not(:disabled),
      &:focus-visible {
        background: rgb(255 255 255 / 0.16);
      }

      &:disabled {
        opacity: 0.4;
      }
    }
  }

  .level {
    min-width: 3.2em;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 0 6px;
    font-size: 0.9em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stage {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 12px 12px;
    cursor: zoom-out;
    touch-action: pan-x pan-y;

    &:focus-visible {
      outline: 1px solid var(--nova-focus);
      outline-offset: -1px;
    }
  }

  img {
    flex: none;
    /* margin: auto centers a small image without cutting off a scrolled one, as flex centering would. */
    margin: auto;
    max-width: none;
    height: auto;
    border-radius: var(--nova-radius);
    background: var(--nova-surface);
    cursor: grab;
    user-select: none;
  }

  .stage.zoomed img {
    border-radius: 0;
  }
</style>
