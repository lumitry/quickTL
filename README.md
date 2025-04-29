# quickTL

A two-file solution for all your translation needs, powered by Ollama!

## Usage

Assuming you already have [Ollama](https://github.com/ollama/ollama) set up and running, using this 'app' is simple:

1. Clone the repository: `git clone https://github.com/lumitry/quickTL`
2. Open the html file in your browser of choice
3. Type in your Ollama API base URL (or stick with the default of `http://localhost:11434` if you're using the default port on the same machine you're already on)
4. Select the model you'd like to use in the dropdown
5. Enter the text you'd like to translate
6. Use `cmd`/`ctrl` + `enter` to submit the text, or click the Translate button.
7. Watch the response stream in!

While generating, you can optionally stop the stream by clicking the Stop button, which seems to cancel the request on Ollama's end as well.

Once it's done, the translation will appear in the history section below the output box. You can remove individual items from the history, or clear it all at once.

![Screenshot of the quickTL user interface](./images/quickTL_UI.webp)

## Features

- Translation history
- API URL, model, and history are all stored in local storage
- Streaming responses
- (NEW 2025-04-29!) Support for reasoning models! The chain of thought is expanded while it is thinking, then auto-collapses when it is done. I plan to introduce configuration options to tweak that behavior in the future.

## To Do

- [ ] Refactor for cleaner code
- [ ] make the styling less "web 1.0"-y
  - [/] add breakpoints for mobile/browser sidebar width so that the title doesn't take up three lines
  - [ ] dark mode
  - [ ] Make it so that you can choose between vertical and horizontal mode (without having to trigger the 600px breakpoint)
  - [x] make the whitespace added by marked.js smaller
- [ ] Add a button to copy the translation to the clipboard (both in output and history)
- [ ] File persistence
- [ ] Vision?? Might be simple if it's just turning the image into base64
- [ ] Language selection (right now, the model has to figure that out on its own)
- [ ] Add a button to clear the text area
- [x] Add images to the README
  - [ ] Put the image in a CDN so that it doesn't have to be downloaded every time someone clones the project
- [ ] maybe also a ~~gif~~ webm?
- [ ] Customizable prompt (perhaps with presets)
- [ ] A settings panel, if that's possible without overcomplicating things
  - [ ] Model parameters
- [ ] Show errors in the UI instead of just console logging them
- [ ] fix `Unchecked runtime.lastError: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received` and the other weird errors I get on occassion
- [ ] Fix stop button not working anymore. Possibly related to recent changes to parsing (2025-04-29)?
- [ ] Test trying to break it intentionally (changing API url then model then going back to the original URL: what happens there? et cetera)
  - Note: I don't consider jailbreaks to be a bug. It's obviously extremely easy to get this to output arbitrary HTML. I might add some sanitzation to the outputs later, but it's not a priority right now.
  - [ ] What happens if you use it from two tabs at once? does it break persisted data?

## Philosophy

(What this is and what it isn't)

This isn't meant to be a chatbot, just a translation tool. Previous translations aren't passed as context.

This is meant to be a simple tool that uses the bare minimum amount of Javascript I can get away with. I don't hate frameworks or anything, but it's so nice to avoid using tooling entirely. Everything works super quickly, and no data is sent to some opaque server in the cloud somewhere.

The cool thing about LLMs for translation, in my opinion, is that they can provide cultural context and other information that a simple translation tool can't. If you *just* want a quick and easy translation, Google Translate or DeepL may be easier—but I reckon using a good LLM can be a lot more insightful. More traditional translation tools may also be better for less common languages.

I'm using Ollama as the backend because it's far simpler than any alternatives for local AI, and the goal of this project is simplicity. I don't plan on adding other generation backends any time soon unless they can be integrated neatly.

I'm considering putting the JS back into the HTML file and going with a one-file solution, but I think it's nice to have the HTML and JS separate. It makes it easier to read and understand what's going on. It also prevents a 500+ line HTML file, which is nice.

## Dependencies

Not really a dependency per se, but this project uses [Marked.js](https://marked.js.org) to render markdown. Changing that should be fairly simple if you want to—for example, you could use a prompt that asks for an HTML response and just render that instead (sounds dangerous, though Marked assumes trusted inputs as well), or you could write a simple parser yourself, or just use a prompt asking for a plain text response.

## Model Selection

I've found that [Google's Gemma 3 series](https://ollama.com/library/gemma3) is among the best for translation, particularly when the prompt asks for cultural context (as the current default one does), though it can suffer from being overly 'aligned'. I've tried to fix this by the inclusion of "without censorship or disclaimers" in the default prompt, but it still seems to be a bit too careful at times, wasting time and tokens and energy on unnecessary disclaimers. Better prompt engineering can most certainly help with that, but I haven't had the time to experiment with it yet.

**Update 2025-04-29:** Qwen 3 seems pretty decent too! Gemma 3 is more conversational, Qwen 3 is a bit more direct and doesn't include cultural context (see current showcase screenshot for example; it doesn't mention that *Primum non nocere* is a fundamental principle/oath of medicine, not anywhere outside of the CoT at least). IBM's Granite 3 series also seems pretty decent. Qwen 3 claims support for over 100 languages though... 👀

Note that I've had to fix a bug (?) in Qwen 3 where using `/no_think` in your prompt causes the model to output an empty think tag, which messes up the parsing logic. Weird.

## Reflection

I didn't think streamed responses would work in vanilla JS like this. Really cool stuff IMO.
