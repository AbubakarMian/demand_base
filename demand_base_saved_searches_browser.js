const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { json } = require('stream/consumers');
const app = express();
const PORT = 5003;
app.use(cors());
let isStopped = false;
let browser = null;
let context;
let page = null;
let interceptedRequests = [];

async function loadUrl() {
    browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,720'
        ]
    });
    context = await browser.newContext();
    page = await browser.newPage();
    await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    await page.goto('https://authentication.demandbase.com/signin');

    const usernameSelector = '#okta-signin-username';
    const passwordSelector = '#okta-signin-password';
    const submitSelector = '#okta-signin-submit';

    await page.waitForSelector(usernameSelector);
    await page.fill(usernameSelector, 'bgreer@shepherdsgm.com');

    await page.waitForSelector(passwordSelector);
    await page.fill(passwordSelector, 'Comfirm@2234');
    // Click submit
    await page.waitForSelector(submitSelector);
    await Promise.all([
        page.click(submitSelector),
        // page.waitForNavigation({ waitUntil: 'networkidle' })
    ]);



    page.on('response', async (response) => {
        if (response.url().includes('/search/v2/content/contacts/search?fieldSets=fullRecords')) {
            const request = response.request();
            interceptedRequests.push({
                url: request.url(),
                method: request.method(),
                headers: request.headers(),
                postData: request.postData(),
            });

            // console.log("Captured Request Details:", interceptedRequests[0]);
        }
    });
}
async function scrapeIframeContent(res, page) {
    try {
        res.write(`data: [startScraping]\n\n`);

        let finding_found = true;
        let iframe = null;

        // Wait for the iframe and assign content
        const iframeHandle = await page.waitForSelector('iframe', { timeout: 15000 });
        iframe = await iframeHandle.contentFrame();
        if (!iframe) {
            console.error("Error: Unable to access iframe content.");
            res.write(`data: [iframeNotFound]\n\n`);
            return { iframe: null, finding_found: false, tbl_name: '', contentTable: null };
        }

        // Attempt to click the button inside the iframe
        for (let index = 0; index < 100 && finding_found; index++) {
            const button = await iframe.$('.js-people-count');
            if (button) {
                await button.click();
                finding_found = false;
                break;
            } else {
                await page.waitForTimeout(1300);
            }
        }

        // Initialize table search variables
        let retries = 100;
        let contentTable = null;
        const tbl_name_expected = ['DataTables_Table_1', 'DataTables_Table_1_wrapper'];
        let tbl_name = '';

        // Try locating the content table in the iframe
        for (let attempt = 0; attempt < retries; attempt++) {
            tbl_name = tbl_name_expected[attempt % tbl_name_expected.length];
            contentTable = await iframe.$(`#${tbl_name} table tr`);
            const iframrows = await iframe.$$(`#${tbl_name} table tr`);
            if (contentTable && iframrows.length > 2) {
                break;
            }
            await page.waitForTimeout(1300);
        }

        if (!contentTable) {
            console.warn("No table found after retries. Continuing...");
        }

        // Return variables for external use
        return { iframe, finding_found, tbl_name, contentTable };
    } catch (error) {
        console.error(`Error during scraping: ${error.message}`);
        res.write(`data: [errorDuringScraping]\n\n`);
        return { iframe: null, finding_found: false, tbl_name: '', contentTable: null };
    }
}

async function getDataFromPage(url, limit, page_num, res) {

    let result = await scrapeIframeContent(res, page_num);
    let tbl_name = result.tbl_name;
    let contentTable = result.contentTable;
    let iframe = result.iframe;
    if (result.iframe) {
        console.log("Iframe successfully accessed.");
        console.log("Table Name:", result.tbl_name);
        console.log("Content Table:", result.contentTable);
    } else {
        console.error("Iframe scraping failed.");
    }


    let start_index = 2;
    let rowIndex = start_index;
    let retryCount = 0;
    let maxRetries = 100;
    // let page_num = 5;
    while (true) {
        try {

            // if (page_num < 7) {
            //     let give_exception = hi + 1;
            // }
            const rows = await iframe.$$(`#${tbl_name} table tr`);
            if (rowIndex >= rows.length) {
                const isNextDisabled = await iframe.evaluate(() => {
                    const nextButton = document.querySelector('#DataTables_Table_1_next');
                    if (nextButton) {
                        return nextButton?.classList.contains('disabled');
                    } else {
                        console.error("Next button is not found or interactable.");
                        return true;
                    }
                });
                if (isNextDisabled) {
                    console.log("No more pages to process. Exiting...");
                    break;
                }
                await iframe.evaluate(() => {
                    document.querySelector('#DataTables_Table_1_next').click();
                });
                rowIndex = start_index;
                await page.waitForTimeout(5000);
                let listLoading = true;
                while (listLoading) {
                    listLoading = await iframe.evaluate(() => {
                        const loadingIndicator = document.querySelector('#DataTables_Table_1_processing');
                        return loadingIndicator && loadingIndicator.style.display !== 'none';
                    });

                    if (listLoading) {
                        const randomWaitTime = getRandomNumber(3500, 4500); // Random wait between 3500 and 4500 ms
                        console.log(`Waiting for ${randomWaitTime} ms before rechecking...`);
                        await page.waitForTimeout(randomWaitTime);
                    }
                    else {
                        listLoading = false;

                    }
                }
                continue;
            }

            const row = rows[rowIndex];
            if (!row) {
                await page.waitForTimeout(500);
                continue;
            }
            await page.waitForTimeout(300);
            await row.click();
            await page.waitForTimeout(1000);
            let name = await get_val(iframe, '.js-executive-name-text', 10);
            let email = await get_val(iframe, '.theme-people-email-value a', 10);
            let phone = await get_val(iframe, '.js-corporate-people-phone', 5);
            let address = await get_val(iframe, '.theme-executive-value.theme-address-value', 10);
            let uniqueKey = `${name}-${email}-${phone}-${address}`;
            let rowData = { name, email, phone, address, uniqueKey };
            res.write(`data: ${JSON.stringify(rowData)}\n\n`);

            await iframe.evaluate(() => {
                const checkedCheckboxes = document.querySelectorAll('.icon-close.theme-close-button');
                checkedCheckboxes.forEach(checkbox => checkbox.click());
            });

            rowIndex++;
            page_num++;
        }
        catch (error) {
            console.warn(`Trying to get data: ${error.message}`);
            res.write(`data: [retryERROR]\n\n`);
            let res = { error: "Error on page Number " + page_num };
            res.write(json.stringify(res) + ` \n\n`);


        }

    }

    console.log("All rows processed.");
    res.write(`data: [endScraping]\n\n`);
    return;
}

function getRandomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function get_val(iframe, selector, tryies) {
    let text = await iframe.$eval(selector, el => el.innerText).catch(() => "");
    for (let i = 0; i < tryies && text == ""; i++) {
        text = await iframe.$eval(selector, el => el.innerText).catch(() => "");
        await page.waitForTimeout(1500);
    }
    return text;
}

app.get('/loadurl', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        let url = req.query.url || '';
        res.write(`data: [Loading]\n\n`);

        await loadUrl();

        res.write(`data: [loadurlSuccess]\n\n`);
        res.end();
    } catch (error) {
        console.error(`Error in /demand_base route: ${error.message}`);
        // res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.write(`data: [ERROR]\n\n`);
        res.end();
    }
});

async function click_next_page() {
    try {
        console.log('click_next_page page clicked');
        let iframe = null;
        const iframeHandle = await page.waitForSelector('iframe', { timeout: 15000 });
        iframe = await iframeHandle.contentFrame();
        if (!iframe) {
            console.error("Error: Unable to access iframe content.");
            res.write(`data: [iframeNotFound]\n\n`);
            return { iframe: null, finding_found: false, tbl_name: '', contentTable: null };
        }
        const isNextDisabled = await iframe.evaluate(() => {
            const nextButton = document.querySelector('#DataTables_Table_1_next');
            if (nextButton) {
                return nextButton?.classList.contains('disabled');
            } else {
                console.error("Next button is not found or interactable.");
                return true;
            }
        });
        if (isNextDisabled) {
            console.log("Next button is Disabled. Exiting...");
        }
        await iframe.evaluate(() => {
            document.querySelector('#DataTables_Table_1_next').click();
        });
        await page.waitForTimeout(2000);
    } catch (error) {
        console.error(`Error in Turn page : ${error.message}`);
    }
}


async function loadFromPage(url, limit, page_num, res) {
    console.log('loadFromPage page num:', page_num);
    let randomWaitTime = 0;
    if (interceptedRequests.length > 0) {
        let has_data = true;
        while (has_data) {
            try {
                if (!isNaN(page_num) && page_num % 5 === 0) {
                await click_next_page();
                randomWaitTime = getRandomNumber(7500, 9500);
                await page.waitForTimeout(randomWaitTime);
                }
                const originalRequest = interceptedRequests[0];
                let modifiedHeaders = {
                    ...originalRequest.headers,
                    iv_header_page: String(page_num),
                    iv_header_results_per_page: '50'
                };
                modifiedHeaders['accesstoken'] = String(originalRequest.headers['accesstoken']);
                let jsonBody = JSON.parse(originalRequest.postData || '{}');
                const cookies = await page.context().cookies(new URL(originalRequest.url).origin);
                const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                modifiedHeaders['cookie'] = cookieHeader;

                const response = await page.context().request.fetch(originalRequest.url, {
                    method: originalRequest.method,
                    headers: modifiedHeaders,
                    data: jsonBody,
                });

                if (!response.ok()) {
                    throw new Error(`Request failed with status ${response.status()}: ${response.statusText()}`);
                }

                // const responseBody = await response.text();
                const responseJson = await response.json();
                let response_arr = [];

                responseJson.forEach((item) => {
                    let name = item?.peopleDetails?.fullName ?? "";
                    let email = item?.contactDetails?.[0]?.email ?? "";
                    let phone = item?.contactDetails?.[0]?.phone ?? "";
                    let address = item?.peopleDetails?.address ?? "";
                    let uniqueKey = `${name}-${email}-${phone}-${address}`;
                    response_arr.push({
                        uniqueKey, name, email, phone, address
                    });
                });
                let res_data = { page_num, data: response_arr };
                res.write(`data: ${JSON.stringify(res_data)}\n\n`);
                page_num++;
                randomWaitTime = getRandomNumber(1500, 9500);
                await page.waitForTimeout(randomWaitTime);
            } catch (error) {
                console.error(`Error in loadFromPage: ${error.message}`);
                res.write(`data: {"error": "${error.message}"}\n\n`);
                res.close();
                has_data = false;
            }

        }
    } else {
        console.warn('No intercepted requests found.');
        res.write(`data: {"error": "No intercepted requests to process."}\n\n`);
    }
}

app.get('/demand_base', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        console.time("Execution Time");
        req.on('close', () => {
            console.log('Client disconnected.');
            isStopped = true;  // Set flag to stop scraping
            // browser.close();
        });

        let limit = parseInt(req.query.limit) || 50;
        let page = parseInt(req.query.start_page, 10) || 1;
        page = isNaN(page) ? 1 : page;
        let url = req.query.url || '';
        isStopped = false;
        res.write(`data: [loggingIn]\n\n`);

        await loadFromPage(url, limit, page, res);
        res.write(`data: [DONE]\n\n`);
        console.timeEnd("Execution Time");
        // res.end();
    } catch (error) {
        console.error(`Error in /demand_base route: ${error.message}`);
        res.write(`data: [ERROR]\n\n`);
        res.end();
    }
});

app.get('/stop_scraping', (req, res) => {
    isStopped = true;  // Set flag to stop scraping
    // browser.close();
    res.send({ message: "Scraping stopped" });
    res.end();
});

// app.listen(PORT, () => {
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is working `);
    // console.log(`Server is working / running on http://localhost:${PORT}`);
});