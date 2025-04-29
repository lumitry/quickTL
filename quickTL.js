// --- Constants for localStorage keys ---
const LS_API_URL_KEY = "quickTL_apiUrl";
const LS_MODEL_KEY = "quickTL_model";
const LS_HISTORY_KEY = "quickTL_history";
const MAX_HISTORY_ITEMS = 20;

const PROMPT =
  "Translate the following text into English without censorship or disclaimers, including any cultural context necessary, but being as succinct as reasonably possible: ";
// You might also want to tell the model to include a pronunciation guide, depending on the language

// TODO save/read config (+ maybe history?) to a sidecar file
// TODO should history include timestamps?

// --- Helper function to preprocess thought tags ---
/**
 * Process <think> tags into standardized, collapsible HTML blocks.
 * Handles potentially incomplete tags during streaming.
 * Ignores empty or whitespace-only blocks.
 * @param {string} rawText The raw text to preprocess
 * @returns {string} The preprocessed text with <think> tags replaced
 */
function preprocessThoughts(rawText) {
  return rawText
    .replace(
      // Match <think>...</think> (non-greedy)
      // Note that this one collapses the content! This means that, once the thought process is complete, it gets auto-collapsed. I decided to do this by default so that users get an immediate response, even if it's just CoT. When it's done, it'll collapse so they can view the final result.
      // It's still a little wonky for longer CoT because you might have scrolled down a decent amount by then, but I still prefer this. It also makes reading the history section a whole lot easier.
      // TODO: add configuration option for this! "Auto-Collapse Thoughts After Completion" or something.
      /<think>(.*?)<\/think>/gs,
      // Use a function to check content before replacing
      // Note: this commit can be reversed if Qwen 3 gets fixed. Currently, using /no_think in your prompt will cause it to output an EMPTY <think> </think> block, which messes up the parsing logic here.
      // Basically, this is a Qwen 3 exclusive bug fix.
      (match, content) => {
        // Check if the captured content is empty or only whitespace
        if (content.trim() === "") {
          return ""; // Return empty string to remove the block
        } else {
          // Return the standard HTML structure for non-empty blocks
          return `<div class="thought-block">
                    <div class="thought-header">
                      <span class="thought-toggle" role="button" tabindex="0" aria-expanded="false">[+]</span>
                      <span class="thought-label" data-duration-placeholder="true"></span>
                    </div>
                    <div class="thought-content collapsed">${content}</div>
                  </div>`;
        }
      }
    )
    .replace(
      // Match <think>... (no closing tag) - Keep this as is, might fill later
      /<think>((?:(?!<\/think>).)*)$/gs,
      `<div class="thought-block thought-incomplete">
         <div class="thought-header">
           <span class="thought-toggle" role="button" tabindex="0" aria-expanded="true">[-]</span>
           <span class="thought-label" data-duration-placeholder="true"></span>
         </div>
         <div class="thought-content">${"$1"}</div>
       </div>`
    );
}

// --- Global variable for AbortController ---
let currentAbortController = null;

// --- Function to render a single history item ---
function renderHistoryItem(item, prepend = false) {
  const historyContainer = document.getElementById("historyContainer");
  const historyItemDiv = document.createElement("div");
  historyItemDiv.classList.add("historyItem");
  historyItemDiv.dataset.timestamp = item.timestamp;

  const modelNameDisplay = item.model ? ` (${item.model})` : "";
  const deleteButtonHtml = `<button class="delete-history-item" title="Delete this item">X</button>`;

  historyItemDiv.innerHTML = `
    ${deleteButtonHtml}
    <p><strong>Input:</strong></p>
    <div class="history-item-input">${item.input}</div>
    <p><strong>Output${modelNameDisplay}:</strong></p>
    <div class="history-item-output">${item.outputHtml}</div>
  `;

  if (prepend) {
    // Find the div containing the H2 and Clear button (assuming it's the first div)
    const headerDiv = historyContainer.querySelector("div:first-of-type");
    if (headerDiv) {
      // Insert the new item *after* the header div using insertAdjacentElement
      headerDiv.insertAdjacentElement("afterend", historyItemDiv);
    } else {
      // Fallback: Prepend directly to the container if header div isn't found
      historyContainer.prepend(historyItemDiv);
      console.warn("History header div not found, prepending directly.");
    }
  } else {
    // For initial load, just append to the container
    historyContainer.appendChild(historyItemDiv);
  }
}

// --- Function to load and render history from localStorage ---
function loadAndRenderHistory() {
  try {
    const savedHistory = localStorage.getItem(LS_HISTORY_KEY);
    if (savedHistory) {
      const history = JSON.parse(savedHistory);
      const historyContainer = document.getElementById("historyContainer");
      // Clear only history items, keep heading and clear button
      const itemsToRemove = historyContainer.querySelectorAll(".historyItem");
      itemsToRemove.forEach((item) => item.remove());

      history.forEach((item) => renderHistoryItem(item, false)); // Append items
    }
  } catch (error) {
    console.error("Error loading or rendering history:", error);
    localStorage.removeItem(LS_HISTORY_KEY);
  }
}

// --- Function to fetch models (remains the same) ---
async function populateModels(apiUrl) {
  const modelSelect = document.getElementById("modelSelect");
  modelSelect.innerHTML = '<option value="">Loading models...</option>';
  modelSelect.disabled = true;

  try {
    const response = await fetch(`${apiUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Failed to fetch models (${response.status})`);
    }
    const data = await response.json();
    console.log("Models data:", data);

    modelSelect.innerHTML = ""; // Clear loading message
    let hasModels = false;
    if (data.models && data.models.length > 0) {
      hasModels = true;
      data.models.forEach((model) => {
        const option = document.createElement("option");
        option.value = model.name;
        option.textContent = model.name;
        modelSelect.appendChild(option);
      });
      modelSelect.disabled = false; // Re-enable
    } else {
      modelSelect.innerHTML = '<option value="">No models found</option>';
    }

    if (hasModels) {
      const savedModel = localStorage.getItem(LS_MODEL_KEY);
      if (savedModel) {
        const exists = Array.from(modelSelect.options).some(
          (opt) => opt.value === savedModel
        );
        if (exists) {
          modelSelect.value = savedModel;
        } else {
          console.warn(
            `Saved model "${savedModel}" not found in current list.`
          );
          localStorage.removeItem(LS_MODEL_KEY);
        }
      }
    }
  } catch (error) {
    console.error("Error fetching models:", error);
    modelSelect.innerHTML = `<option value="">Error loading models</option>`;
  }
}

// --- Translate function with AbortController ---
function translate() {
  // Abort previous request if any
  if (currentAbortController) {
    currentAbortController.abort();
    console.log("Previous translation aborted.");
  }
  // Create a new AbortController for this request
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const apiUrl = document.getElementById("apiUrlSelect").value;
  const modelSelect = document.getElementById("modelSelect");
  const modelName = modelSelect.value;
  const input = document.getElementById("inputText").value;
  const outputDiv = document.getElementById("outputText");
  const spinner = document.getElementById("loadingSpinner");
  const elapsedTimeDiv = document.getElementById("elapsedTime");
  const stopButton = document.getElementById("stopButton");

  if (!input || !apiUrl || !modelName) {
    if (!apiUrl) alert("Please select an API URL.");
    if (!modelName) alert("Please select a model.");
    if (!input) alert("Please enter text to translate.");
    return;
  }

  localStorage.setItem(LS_MODEL_KEY, modelName);

  console.log(`Translating with ${modelName} at ${apiUrl}:`, input);
  outputDiv.innerHTML = "";
  elapsedTimeDiv.textContent = "";
  spinner.classList.remove("hidden");
  stopButton.classList.remove("hidden");

  fetch(`${apiUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelName,
      prompt: `${PROMPT}${input}`,
      stream: true,
    }),
    signal: signal,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          `Network response was not ok (${response.status} ${response.statusText})`
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullResponseRaw = "";
      let finalData = null;
      let buffer = ""; // Buffer for incoming data

      (async () => {
        try {
          // Outer try for reader errors
          while (true) {
            const { value, done } = await reader.read();

            if (done) {
              // Process any remaining data in the buffer after stream ends
              if (buffer.trim()) {
                console.warn(
                  "Processing remaining buffer content:",
                  `"${buffer.trim()}"`
                );
                try {
                  const data = JSON.parse(buffer.trim());
                  // Potentially process last chunk if it contained response or final data
                  if (data.response) {
                    const textChunk = data.response;
                    fullResponseRaw += textChunk;
                    // Update UI one last time with final part
                    outputDiv.innerHTML = marked.parse(fullResponseRaw, {
                      breaks: false,
                    });
                  }
                  if (data.done) {
                    finalData = data; // Capture final data if it was the last thing
                  }
                } catch (e) {
                  console.error(
                    "Error parsing final buffer content:",
                    e.message,
                    `Content: "${buffer.trim()}"`
                  );
                }
              }
              console.log("Stream complete.");
              break; // Exit the reading loop
            }

            buffer += decoder.decode(value, { stream: true }); // Append new data

            // Process buffer line by line based on newline delimiter
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
              const line = buffer.substring(0, newlineIndex).trim(); // Extract line up to newline
              buffer = buffer.substring(newlineIndex + 1); // Remove processed line (and newline) from buffer

              if (line) {
                // Process non-empty lines
                try {
                  const data = JSON.parse(line);
                  if (data.response) {
                    const textChunk = data.response;
                    fullResponseRaw += textChunk;
                    // Preprocess thoughts before rendering live update
                    const processedText = preprocessThoughts(fullResponseRaw);
                    outputDiv.innerHTML = marked.parse(processedText, {
                      breaks: false,
                    });
                  }
                  // Crucially, check for 'done' status in *any* parsed object
                  if (data.done) {
                    finalData = data; // Capture the final status object whenever it arrives
                  }
                } catch (e) {
                  // Log error but continue processing buffer/stream
                  console.warn(
                    `Error parsing JSON line: ${e.message}`,
                    `Line: "${line}"`
                  );
                }
              }
            } // End while processing buffer for newlines
          } // End while reading stream

          // --- All stream reading is done, now finalize ---

          let durationText = "Thought Process"; // Default label if no duration
          // Calculate duration if available (using eval_duration)
          if (finalData && finalData.eval_duration) {
            // Use eval_duration (generation time) as proxy for thought time
            const durationSeconds = (finalData.eval_duration / 1e9).toFixed(2);
            durationText = `Thought Process (${durationSeconds}s)`;
          } else if (finalData && finalData.total_duration) {
            // Fallback to total_duration if eval_duration is missing
            const durationSeconds = (finalData.total_duration / 1e9).toFixed(2);
            durationText = `Thought Process (Total: ${durationSeconds}s)`;
            console.warn(
              "Using total_duration for thought label as eval_duration is missing."
            );
          } else {
            console.warn("No duration data found for thought label.");
          }

          // Mark all rendered thought blocks in the output as complete and update label
          const outputThoughtBlocks =
            outputDiv.querySelectorAll(".thought-block");
          outputThoughtBlocks.forEach((block) => {
            block.classList.remove("thought-incomplete"); // Remove incomplete class if present
            block.classList.add("thought-complete");

            const label = block.querySelector(".thought-label");
            if (label) {
              label.textContent = durationText; // Set the final label text
            }
          });

          // Update elapsed time display
          if (finalData && finalData.total_duration) {
            const durationSeconds = (finalData.total_duration / 1e9).toFixed(2);
            elapsedTimeDiv.textContent = `Time elapsed: ${durationSeconds}s`;
          } else {
            console.warn(
              "Final duration data not found or parsed correctly from stream."
            );
            // Avoid overwriting error/stopped messages
            if (
              !elapsedTimeDiv.textContent.includes("Error") &&
              !elapsedTimeDiv.textContent.includes("Stopped")
            ) {
              // Set a default message or leave blank if duration is missing
              elapsedTimeDiv.textContent = "Time elapsed: N/A";
            }
          }

          // Save to history if we received content
          if (fullResponseRaw) {
            // Preprocess the final raw text for history
            const processedTextForHistory = preprocessThoughts(fullResponseRaw);

            // Add complete class and duration label to the HTML string for history
            let finalHistoryHtml = processedTextForHistory
              .replace(
                /class="thought-block.*?"/g, // Match class attribute potentially with incomplete
                'class="thought-block thought-complete"' // Replace with just complete
              )
              .replace(
                /<span class="thought-label".*?><\/span>/g, // Match label span with potential placeholder attribute
                `<span class="thought-label">${durationText}</span>` // Replace with final label text
              );

            const renderedFullResponse = marked.parse(finalHistoryHtml, {
              breaks: false,
            });
            console.log(
              "Final raw response for history item:",
              fullResponseRaw
            );
            const newItem = {
              input: input,
              outputHtml: renderedFullResponse, // Save the final processed HTML
              model: modelName,
              timestamp: new Date().toISOString(),
            };
            try {
              let history = JSON.parse(
                localStorage.getItem(LS_HISTORY_KEY) || "[]"
              );
              history.unshift(newItem);
              if (history.length > MAX_HISTORY_ITEMS) {
                history = history.slice(0, MAX_HISTORY_ITEMS);
              }
              localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(history));
              renderHistoryItem(newItem, true);
            } catch (error) {
              console.error("Error saving history:", error);
            }
          } else {
            // Handle case where stream completed but no response content was parsed
            console.log("Stream completed without any response content.");
            if (
              !outputDiv.innerHTML &&
              !elapsedTimeDiv.textContent.includes("Error") &&
              !elapsedTimeDiv.textContent.includes("Stopped")
            ) {
              outputDiv.innerHTML = "<em>Received empty response.</em>";
            }
          }

          stopButton.classList.add("hidden"); // Hide stop button on successful completion
        } catch (streamError) {
          // Catch errors from reader.read() itself
          console.error("Error reading stream:", streamError);
          outputDiv.innerHTML = `<span style="color: red;">Error reading response stream.</span>`;
          elapsedTimeDiv.textContent = "Error occurred.";
          stopButton.classList.add("hidden"); // Hide stop button on stream error
        }
      })(); // End async IIFE
    })
    .catch((error) => {
      // Catch fetch initiation errors, network errors, or AbortError
      if (error.name === "AbortError") {
        console.log("Fetch aborted by user.");
        outputDiv.innerHTML = "<em>Translation stopped.</em>";
        elapsedTimeDiv.textContent = "Stopped.";
        // Keep stop button visible here
      } else {
        console.error("Error during translation fetch/setup:", error);
        outputDiv.innerHTML = `<span style="color: red;">Error: ${error.message}</span>`;
        elapsedTimeDiv.textContent = "Error occurred.";
        stopButton.classList.add("hidden"); // Hide stop button on other errors
      }
    })
    .finally(() => {
      // Runs after fetch promise settles (after .then or .catch)
      spinner.classList.add("hidden"); // Always hide spinner
      currentAbortController = null; // Always clear controller
      // Note: stopButton hiding is now handled inside the async IIFE or the .catch block
    });
}

// --- Helper function to get required DOM elements ---
function getDOMElements() {
  return {
    translateButton: document.getElementById("translateButton"),
    stopButton: document.getElementById("stopButton"),
    clearHistoryButton: document.getElementById("clearHistoryButton"),
    historyContainer: document.getElementById("historyContainer"),
    inputText: document.getElementById("inputText"),
    apiUrlInput: document.getElementById("apiUrlSelect"),
    modelSelect: document.getElementById("modelSelect"),
    // Add other elements if needed later
  };
}

// --- Setup function for API URL and Model selection ---
function setupApiAndModelControls(apiUrlInput, modelSelect) {
  if (!apiUrlInput) {
    console.error("API URL input element not found!");
    return;
  }

  const savedApiUrl = localStorage.getItem(LS_API_URL_KEY);
  if (savedApiUrl) {
    apiUrlInput.value = savedApiUrl;
  }

  populateModels(apiUrlInput.value); // Initial population

  apiUrlInput.addEventListener("change", (event) => {
    const newUrl = event.target.value;
    localStorage.setItem(LS_API_URL_KEY, newUrl);
    populateModels(newUrl); // Repopulate on change
  });

  apiUrlInput.addEventListener("input", (event) => {
    localStorage.setItem(LS_API_URL_KEY, event.target.value);
  });

  // Add listener for model selection saving
  if (modelSelect) {
    modelSelect.addEventListener("change", (event) => {
      localStorage.setItem(LS_MODEL_KEY, event.target.value);
    });
  } else {
    console.error("Model select element not found!");
  }
}

// --- Setup function for Translation and Stop buttons ---
function setupActionButtons(translateButton, stopButton) {
  if (translateButton) {
    translateButton.addEventListener("click", translate);
  } else {
    console.error("Translate button not found!");
  }

  if (stopButton) {
    stopButton.addEventListener("click", () => {
      if (currentAbortController) {
        currentAbortController.abort();
        console.log("Stop button clicked, aborting fetch.");
      }
    });
  } else {
    console.error("Stop button not found!");
  }
}

// --- Setup function for History controls ---
function setupHistoryControls(clearHistoryButton, historyContainer) {
  if (clearHistoryButton) {
    clearHistoryButton.addEventListener("click", () => {
      if (confirm("Are you sure you want to clear all translation history?")) {
        localStorage.removeItem(LS_HISTORY_KEY);
        const itemsToRemove =
          historyContainer?.querySelectorAll(".historyItem"); // Add safe navigation
        itemsToRemove?.forEach((item) => item.remove());
        console.log("History cleared.");
      }
    });
  } else {
    console.error("Clear History button not found!");
  }

  if (historyContainer) {
    historyContainer.addEventListener("click", (event) => {
      if (event.target.classList.contains("delete-history-item")) {
        const itemDiv = event.target.closest(".historyItem");
        if (itemDiv && itemDiv.dataset.timestamp) {
          const timestampToDelete = itemDiv.dataset.timestamp;
          console.log(
            "Deleting history item with timestamp:",
            timestampToDelete
          );
          itemDiv.remove();
          try {
            let history = JSON.parse(
              localStorage.getItem(LS_HISTORY_KEY) || "[]"
            );
            const updatedHistory = history.filter(
              (item) => item.timestamp !== timestampToDelete
            );
            localStorage.setItem(
              LS_HISTORY_KEY,
              JSON.stringify(updatedHistory)
            );
          } catch (error) {
            console.error(
              "Error updating history in localStorage after delete:",
              error
            );
          }
        }
      }
    });
  } else {
    console.error("History container not found for delete listener!");
  }
}

// --- Setup function for Input Text Area ---
function setupInputTextArea(inputText) {
  if (inputText) {
    inputText.addEventListener("keydown", function (event) {
      // Use Command key on Mac, Ctrl key on other OSes
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault(); // Prevent default Enter behavior (new line)
        translate(); // Trigger translation
      }
    });
  } else {
    console.error("Input textarea not found!");
  }
}

// --- Setup function for Thought Block Toggling ---
function setupThoughtToggling() {
  // Define the handler function once
  const handleToggle = (event) => {
    // Find the header element that was clicked or contains the clicked element
    const header = event.target.closest(".thought-header");
    if (!header) return; // Exit if the click wasn't inside a header

    // Find the parent thought block
    const thoughtBlock = header.closest(".thought-block");
    if (!thoughtBlock) return; // Should not happen if header is found

    // Find the content and toggle elements within the block
    const content = thoughtBlock.querySelector(".thought-content");
    const toggle = header.querySelector(".thought-toggle"); // Find the toggle within the clicked header

    if (content && toggle) {
      const isCollapsed = content.classList.toggle("collapsed");
      toggle.textContent = isCollapsed ? "[+]" : "[-]";
      toggle.setAttribute("aria-expanded", !isCollapsed);
    }
  };

  // Define the keydown handler
  const handleKeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      // Check if the focused element is the toggle or header itself
      const header = event.target.closest(".thought-header");
      const toggle = event.target.closest(".thought-toggle");

      if (header || toggle) {
        // Check if focus is on header or toggle
        event.preventDefault(); // Prevent default space scroll or enter submit
        // Find the header to simulate the click logic correctly
        const targetHeader = header || toggle.closest(".thought-header");
        if (targetHeader) {
          targetHeader.click(); // Simulate a click on the header
        }
      }
    }
  };

  // Use event delegation on containers that will hold the thought blocks
  const outputContainer = document.getElementById("outputText");
  const historyContainer = document.getElementById("historyContainer");

  if (outputContainer) {
    outputContainer.addEventListener("click", handleToggle);
  } else {
    console.error(
      "Output container #outputText not found for toggle listener."
    );
  }

  if (historyContainer) {
    historyContainer.addEventListener("click", handleToggle);
  } else {
    console.error(
      "History container #historyContainer not found for toggle listener."
    );
  }

  // Attach keydown listener to the body to catch focused elements anywhere
  document.body.addEventListener("keydown", handleKeydown);
}

// --- DOMContentLoaded Event Listener ---
document.addEventListener("DOMContentLoaded", function () {
  // Get all necessary elements once
  const elements = getDOMElements();

  // Load initial state
  loadAndRenderHistory();

  // Setup controls
  setupApiAndModelControls(elements.apiUrlInput, elements.modelSelect);
  setupActionButtons(elements.translateButton, elements.stopButton);
  setupHistoryControls(elements.clearHistoryButton, elements.historyContainer);
  setupInputTextArea(elements.inputText);
  setupThoughtToggling();

  console.log("QuickTL application initialized.");
});
