export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6 py-16 dark:bg-black">
      <h1 className="max-w-2xl text-center text-4xl font-semibold leading-tight tracking-tight text-black sm:text-5xl dark:text-zinc-50">
        Finds your Gurbani. Never writes it.
      </h1>
      <p className="mt-6 max-w-xl text-center text-base leading-7 text-zinc-600 dark:text-zinc-400">
        Semantic search across the Sri Guru Granth Sahib. Retrieval only. No generation of
        scripture.
      </p>
    </main>
  );
}
