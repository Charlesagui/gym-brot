<script lang="ts">
	import { pulsar } from '$lib/pulsar';

	// Control reutilizable −/input/+ (peso y reps). El − es neutro; el + se tiñe con el glow.
	let {
		value,
		format,
		inputmode,
		step,
		glow,
		onStep,
		onCommit,
		ariaDown,
		ariaUp,
		ariaInput
	}: {
		value: number | undefined;
		format: (n: number) => string;
		inputmode: 'decimal' | 'numeric';
		step: number;
		glow: string;
		onStep: (delta: number) => void;
		onCommit: (el: HTMLInputElement) => void;
		ariaDown: string;
		ariaUp: string;
		ariaInput: string;
	} = $props();
</script>

<div class="flex items-center rounded-lg bg-white/5 p-1">
	<button
		use:pulsar={() => onStep(-step)}
		class="grid size-10 shrink-0 touch-manipulation select-none place-items-center rounded-md text-lg font-bold"
		style="background: rgba(255,255,255,.06); color: var(--muted)"
		aria-label={ariaDown}>−</button
	>
	<input
		type="text"
		{inputmode}
		value={value != null ? format(value) : ''}
		placeholder="—"
		onfocus={(e) => e.currentTarget.select()}
		onchange={(e) => onCommit(e.currentTarget)}
		onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
		class="w-full min-w-0 bg-transparent text-center text-base font-bold tabular-nums outline-none"
		aria-label={ariaInput}
	/>
	<button
		use:pulsar={() => onStep(step)}
		class="grid size-10 shrink-0 touch-manipulation select-none place-items-center rounded-md text-lg font-bold"
		style="background: rgb({glow} / .18); color: rgb({glow})"
		aria-label={ariaUp}>+</button
	>
</div>
