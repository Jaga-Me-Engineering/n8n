import {
	IExecuteFunctions,
} from 'n8n-core';

import {
	IDataObject,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	NodeApiError,
} from 'n8n-workflow';

import {
	OptionsWithUri,
} from 'request';

/**
 * Make an authenticated API request to Bitwarden.
 */
export async function bitwardenApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: string,
	endpoint: string,
	qs: IDataObject,
	body: IDataObject,
	token: string,
): Promise<any> { // tslint:disable-line:no-any

	const options: OptionsWithUri = {
		headers: {
			'user-agent': 'n8n',
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		method,
		qs,
		body,
		uri: `${getBaseUrl.call(this)}${endpoint}`,
		json: true,
	};

	if (!Object.keys(body).length) {
		delete options.body;
	}

	if (!Object.keys(qs).length) {
		delete options.qs;
	}

	try {
		return await this.helpers.request!(options);
	} catch (error) {

		if (error.statusCode === 404) {
			throw new Error('Bitwarden error response [404]: Not found');
		}

		if (error?.response?.body?.Message) {
			const message = error?.response?.body?.Message;
			throw new Error(`Bitwarden error response [${error.statusCode}]: ${message}`);
		}
		//TODO handle Errors array
		throw error;
	}
}

/**
 * Retrieve the access token needed for every API request to Bitwarden.
 */
export async function getAccessToken(
	this: IExecuteFunctions | ILoadOptionsFunctions,
): Promise<any> { // tslint:disable-line:no-any

	const credentials = this.getCredentials('bitwardenApi') as IDataObject;

	const options: OptionsWithUri = {
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		method: 'POST',
		form: {
			client_id: credentials.clientId,
			client_secret: credentials.clientSecret,
			grant_type: 'client_credentials',
			scope: 'api.organization',
			deviceName: 'n8n',
			deviceType: 2, // https://github.com/bitwarden/server/blob/master/src/Core/Enums/DeviceType.cs
			deviceIdentifier: 'n8n',
		},
		uri: getTokenUrl.call(this),
		json: true,
	};

	try {
		const { access_token } = await this.helpers.request!(options);
		return access_token;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error);
	}
}

/**
 * Supplement a `getAll` operation with `returnAll` and `limit` parameters.
 */
export async function handleGetAll(
	this: IExecuteFunctions,
	i: number,
	method: string,
	endpoint: string,
	qs: IDataObject,
	body: IDataObject,
	token: string,
) {
	const responseData = await bitwardenApiRequest.call(this, method, endpoint, qs, body, token);
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;

	if (returnAll) {
		return responseData.data;
	} else {
		const limit = this.getNodeParameter('limit', i) as number;
		return responseData.data.slice(0, limit);
	}
}

/**
 * Return the access token URL based on the user's environment.
 */
function getTokenUrl(this: IExecuteFunctions | ILoadOptionsFunctions) {
	const { environment, domain } = this.getCredentials('bitwardenApi') as IDataObject;

	return environment === 'cloudHosted'
		? 'https://identity.bitwarden.com/connect/token'
		: `${domain}/identity/connect/token`;

}

/**
 * Return the base API URL based on the user's environment.
 */
function getBaseUrl(this: IExecuteFunctions | ILoadOptionsFunctions) {
	const { environment, domain } = this.getCredentials('bitwardenApi') as IDataObject;

	return environment === 'cloudHosted'
		? 'https://api.bitwarden.com'
		: `${domain}/api`;

}

/**
 * Load a resource so that it can be selected by name from a dropdown.
 */
export async function loadResource(
	this: ILoadOptionsFunctions,
	resource: string,
) {
	const returnData: INodePropertyOptions[] = [];
	const token = await getAccessToken.call(this);
	const endpoint = `/public/${resource}`;

	const { data } = await bitwardenApiRequest.call(this, 'GET', endpoint, {}, {}, token);

	data.forEach(({ id, name }: { id: string, name: string }) => {
		returnData.push({
			name: name || id,
			value: id,
		});
	});

	return returnData;
}
