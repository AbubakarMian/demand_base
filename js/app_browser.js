let eventSource;
let isStopped = false;
let db;
let table_data = [];
let totalRecords = 0;
let uniqueRecords = 0;
let duplicateRecords = 0;
let db_store = null;

async function total_records_view_update() {
    let total = await getTotalRecords();
    console.log('total number records : ', total);
    $('#total').text(total);
    $('#unique').text(total);
}
async function clear_previous_record() {
    try {
        if (!db) {
            await initializeIndexedDB();
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction("records", "readwrite");
            const objectStore = transaction.objectStore("records");
            const clearRequest = objectStore.clear();

            clearRequest.onsuccess = () => {
                console.log("Previous IndexedDB data cleared.");
                resolve();
            };

            clearRequest.onerror = (event) => {
                console.error("Error clearing IndexedDB data:", event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error("Error in clear_previous_record:", error);
        throw error;
    }
}
async function initializeIndexedDB() {
    return new Promise((resolve, reject) => {
        const dbRequest = indexedDB.open("UniqueRecordsDB", 1);

        dbRequest.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("records")) {
                db.createObjectStore("records", { keyPath: "uniqueKey" });
            }
        };

        dbRequest.onsuccess = (event) => {
            db = event.target.result; // Save the database reference
            console.log("IndexedDB initialized successfully.");
            resolve();
        };

        dbRequest.onerror = (event) => {
            console.error("Error initializing IndexedDB:", event.target.error);
            reject(event.target.error);
        };
    });
}

async function addRecordToIndexedDB(records_arr, onSuccess, onDuplicate) {
    if (!db) {
        console.error("IndexedDB is not initialized!");
        return;
    }

    console.log("Adding records to IndexedDB...");
    const transaction = db.transaction("records", "readwrite");
    const store = transaction.objectStore("records");

    for (const record of records_arr) {
        console.log("Processing record:", record);

        try {
            const existingRecord = await checkRecordExists(store, record.uniqueKey);

            if (!existingRecord) {
                await addRecord(store, record);
                console.log("Record added successfully:", record);
                onSuccess();
            } else {
                console.log("Duplicate record found:", record.uniqueKey);
                onDuplicate();
            }
        } catch (err) {
            console.error("Error processing record:", err);
        }
    }

    transaction.oncomplete = () => {
        console.log("Transaction completed.");
    };

    transaction.onerror = (err) => {
        console.error("Transaction error:", err.target.error);
    };
}

// Helper function to check if a record exists
function checkRecordExists(store, uniqueKey) {
    return new Promise((resolve, reject) => {
        const request = store.get(uniqueKey);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (err) => reject(err.target.error);
    });
}

// Helper function to add a record
function addRecord(store, record) {
    return new Promise((resolve, reject) => {
        const request = store.add(record);

        request.onsuccess = () => resolve();
        request.onerror = (err) => reject(err.target.error);
    });
}

function updateRecordNumbers(totalRecords, uniqueRecords, duplicateRecords) {
    total_records_view_update();
    // $('#total').text(totalRecords);
    // $('#unique').text(uniqueRecords);
    // $('#duplicate').text(duplicateRecords);
}
document.getElementById("startButton").addEventListener("click", () => {
    try {
        $("#startButton").css("display", "none");
        $("#stopButton").css("display", "block");
        $("#downloadCsvButton").css("display", "none");

        const tableBody = document.querySelector("#dataTable tbody");
        initializeIndexedDB();
        // Prevent starting if already running
        if (eventSource && !isStopped) return;

        console.log("Starting data fetch...");
        isStopped = false;
        tableBody.innerHTML = "";
        let start_page = $('#start_page').val();

        // Replace with your actual API endpoint
        eventSource = new EventSource(`http://localhost:5003/demand_base?start_page=${start_page}`);

        eventSource.onmessage = (event) => {
            if (event.data === "[Loading]") {
                showLoadingModal("Loading...");
                return;
            }

            if (event.data === "[loadingURL]") {
                showLoadingModal("Loading URL...");
                return;
            }

            if (event.data === "[DONE]") {
                eventSource.close();
                $("#stopButton").click();
                return;
            }

            if (event.data === "[ERROR]") {
                showServerError();
                eventSource.close();
                $("#stopButton").click();
                return;
            }

            hideLoadingModal();
            const response = JSON.parse(event.data);
            const page_num = response.page_num ?? '';
            const rowsData = response.data;
            if (!isNaN(page_num)) {
                $('#pages_scraped').text(page_num);
            }
            else {
                console.log('i think json failed', response);
                console.log('page_num', page_num);
            }
            addRecordToIndexedDB(
                rowsData,
                () => {
                    addRowsToTable(rowsData, tableBody);
                    showToast(`${rowsData.length} Rows added successfully`);
                },
                () => {
                    showErrorToast(`Duplicate data found`);
                }
            );
        };

        eventSource.onerror = (error) => {
            showErrorToast(`Browser isn't responding please close captch its closed and try agin from page number ${rowsData.page_num}.`);
            console.error("Error receiving data:", error);
            showServerError();
            eventSource.close();
        };
    } catch (error) {
        showErrorToast(`Browser isn't responding please close captch its closed and try agin from page number ${rowsData.page_num}.`);
        console.error("Main try catch :", error);
        showServerError();
        eventSource.close();
    }
});

function showLoadingModal(message) {
    $("#loadingMessage").text(message);
    const loadingModal = new bootstrap.Modal(document.getElementById("loadingModal"));
    loadingModal.show();
}

function hideLoadingModal() {
    $("#closeLoadingbtn").click();
}

function showServerError() {
    $(".server_error").css("display", "block");
}

function addRowsToTable(rowsData, tableBody) {
    tableBody.innerHTML = "";
    rowsData.forEach(rowData => {
        const newRow = document.createElement("tr");
        newRow.innerHTML = `
        <td>${rowData.name}</td>
        <td>${rowData.email}</td>
        <td>${rowData.phone}</td>
        <td>${rowData.address}</td>`;
        tableBody.appendChild(newRow);
    });
}

function showToast(message) {
    document.getElementById("toastContent").innerText = message;
    const infoToast = new bootstrap.Toast(document.getElementById("infoToast"));
    infoToast.show();
}

function showErrorToast(message) {
    document.getElementById("errorToastContent").innerText = message;
    const errorToast = new bootstrap.Toast(document.getElementById("errorToast"));
    errorToast.show();
}

window.addEventListener("beforeunload", () => {
    if (eventSource) {
        eventSource.close();
    }
});

document.getElementById('loadButton').addEventListener('click', async () => {
    $("#loadButton").css('display', 'none');
    $("#startButton").css('display', 'block');
    $("#stopButton").css('display', 'none');
    $("#downloadCsvButton").css('display', 'none');
    await fetch('http://localhost:5003/loadurl', { method: 'GET' });
    console.log("Open browser.");
});

document.getElementById('stopButton').addEventListener('click', async () => {
    $("#startButton").css('display', 'none');
    $("#stopButton").css('display', 'none');
    $("#downloadCsvButton").css('display', 'block');

    if (eventSource) {
        isStopped = true;
        eventSource.close();
        eventSource = null;
        await fetch('http://localhost:5003/stop_scraping', { method: 'GET' });
        console.log("Scraping stopped by the user.");
    }
});

async function getAllRecords() {
    if (!db) {
        console.error("Database is not initialized!");
        return [];
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction("records", "readonly");
        const store = transaction.objectStore("records");
        const request = store.getAll();

        request.onsuccess = () => {
            console.log("Fetched records:", request.result);
            resolve(request.result || []);
        };

        request.onerror = () => {
            console.error("Error fetching all records from IndexedDB:", request.error);
            reject(request.error);
        };
    });
}

function convertToCSV(data) {
    if (!data.length) return "";
    const headers = Object.keys(data[0]).filter((header) => header !== "uniqueKey");
    const csvRows = [headers.join(",")];
    data.forEach((record) => {
        const row = headers.map((header) => {
            const value = record[header];
            return `"${String(value || "").replace(/"/g, '""')}"`;
        });
        csvRows.push(row.join(","));
    });

    return csvRows.join("\n");
}

function downloadCSV(csvData) {
    console.log('downloadCSV');
    const blob = new Blob([csvData], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = $("<a>")
        .attr("href", url)
        .attr("download", "data.csv")
        .appendTo("body");
    link[0].click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function getTotalRecords() {
    if (!db) {
        console.log("Database is not initialized. Initializing now...");
        await initializeIndexedDB();
    }
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("records", "readonly");
        const objectStore = transaction.objectStore("records");
        const request = objectStore.count();

        request.onsuccess = () => {
            console.log("Total records count:", request.result);
            resolve(request.result);
        };

        request.onerror = (err) => {
            console.error("Error counting records:", err.target.error);
            reject(err.target.error);
        };
    });
}
async function downloadData() {
    try {
        if (!db) {
            await initializeIndexedDB();
        }
        const records = await getAllRecords();
        console.log("Records fetched for download:", records);
        if (!records || records.length === 0) {
            alert("No data to download!");
            return;
        }
        const csvData = convertToCSV(records);
        downloadCSV(csvData);
    } catch (error) {
        console.error("Error downloading CSV:", error);
        alert("Error occurred while downloading data. Please try again.");
    }
}
