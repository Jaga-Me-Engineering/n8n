import {
	IHookFunctions,
	IWebhookFunctions,
} from 'n8n-core';

import {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
	NodeApiError,
} from 'n8n-workflow';

import {
	apiRequest,
	getForms,
	ITypeformAnswer,
	ITypeformAnswerField,
	ITypeformDefinition,
} from './GenericFunctions';

export class TypeformTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Typeform Trigger',
		name: 'typeformTrigger',
		icon: 'file:typeform.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '=Form ID: {{$parameter["formId"]}}',
		description: 'Starts the workflow on a Typeform form submission.',
		defaults: {
			name: 'Typeform Trigger',
			color: '#404040',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'typeformApi',
				required: true,
				displayOptions: {
					show: {
						authentication: [
							'accessToken',
						],
					},
				},
			},
			{
				name: 'typeformOAuth2Api',
				required: true,
				displayOptions: {
					show: {
						authentication: [
							'oAuth2',
						],
					},
				},
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{
						name: 'Access Token',
						value: 'accessToken',
					},
					{
						name: 'OAuth2',
						value: 'oAuth2',
					},
				],
				default: 'accessToken',
				description: 'The resource to operate on.',
			},
			{
				displayName: 'Form',
				name: 'formId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getForms',
				},
				options: [],
				default: '',
				required: true,
				description: 'Form which should trigger workflow on submission.',
			},
			{
				displayName: 'Simplify Answers',
				name: 'simplifyAnswers',
				type: 'boolean',
				default: true,
				description: 'Converts the answers to a key:value pair ("FIELD_TITLE":"USER_ANSER") to be easily processable.',
			},
			{
				displayName: 'Only Answers',
				name: 'onlyAnswers',
				type: 'boolean',
				default: true,
				description: 'Returns only the answers of the form and not any of the other data.',
			},
		],
	};

	methods = {
		loadOptions: {
			getForms,
		},
	};

	// @ts-ignore (because of request)
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				const webhookUrl = this.getNodeWebhookUrl('default');

				const formId = this.getNodeParameter('formId') as string;

				const endpoint = `forms/${formId}/webhooks`;

				const { items } = await apiRequest.call(this, 'GET', endpoint, {});

				for (const item of items) {
					if (item.form_id === formId
						&& item.url === webhookUrl) {
						webhookData.webhookId = item.tag;
						return true;
					}
				}

				return false;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');

				const formId = this.getNodeParameter('formId') as string;
				const webhookId = 'n8n-' + Math.random().toString(36).substring(2, 15);

				const endpoint = `forms/${formId}/webhooks/${webhookId}`;

				// TODO: Add HMAC-validation once either the JSON data can be used for it or there is a way to access the binary-payload-data
				const body = {
					url: webhookUrl,
					enabled: true,
					verify_ssl: true,
				};

				await apiRequest.call(this, 'PUT', endpoint, body);

				const webhookData = this.getWorkflowStaticData('node');
				webhookData.webhookId = webhookId;

				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const formId = this.getNodeParameter('formId') as string;

				const webhookData = this.getWorkflowStaticData('node');

				if (webhookData.webhookId !== undefined) {
					const endpoint = `forms/${formId}/webhooks/${webhookData.webhookId}`;

					try {
						const body = {};
						await apiRequest.call(this, 'DELETE', endpoint, body);
					} catch (e) {
						return false;
					}
					// Remove from the static workflow data so that it is clear
					// that no webhooks are registred anymore
					delete webhookData.webhookId;
				}

				return true;
			},
		},
	};



	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const bodyData = this.getBodyData();

		const simplifyAnswers = this.getNodeParameter('simplifyAnswers') as boolean;
		const onlyAnswers = this.getNodeParameter('onlyAnswers') as boolean;

		if (bodyData.form_response === undefined ||
			(bodyData.form_response as IDataObject).definition === undefined ||
			(bodyData.form_response as IDataObject).answers === undefined
		) {
			throw new NodeApiError(this.getNode(), bodyData, { message: 'Expected definition/answers data is missing!' });
		}

		const answers = (bodyData.form_response as IDataObject).answers as ITypeformAnswer[];

		// Some fields contain lower level fields of which we are only interested of the values
		const subvalueKeys = [
			'label',
			'labels',
		];

		if (simplifyAnswers === true) {
			// Convert the answers to simple key -> value pairs
			const definition = (bodyData.form_response as IDataObject).definition as ITypeformDefinition;

			// Create a dictionary to get the field title by its ID
			const defintitionsById: { [key: string]: string; } = {};
			for (const field of definition.fields) {
				defintitionsById[field.id] = field.title.replace(/\{\{/g, '[').replace(/\}\}/g, ']');
			}

			// Convert the answers to key -> value pair
			const convertedAnswers: IDataObject = {};
			for (const answer of answers) {
				let value = answer[answer.type];
				if (typeof value === 'object') {
					for (const key of subvalueKeys) {
						if ((value as IDataObject)[key] !== undefined) {
							value = (value as ITypeformAnswerField)[key];
							break;
						}
					}
				}
				convertedAnswers[defintitionsById[answer.field.id]] = value;
			}

			if (onlyAnswers === true) {
				// Only the answers should be returned so do it directly
				return {
					workflowData: [
						this.helpers.returnJsonArray([convertedAnswers]),
					],
				};
			} else {
				// All data should be returned but the answers should still be
				// converted to key -> value pair so overwrite the answers.
				(bodyData.form_response as IDataObject).answers = convertedAnswers;
			}
		}

		if (onlyAnswers === true) {
			// Return only the answer
			return {
				workflowData: [
					this.helpers.returnJsonArray([answers as unknown as IDataObject]),
				],
			};
		} else {
			// Return all the data that got received
			return {
				workflowData: [
					this.helpers.returnJsonArray([bodyData]),
				],
			};
		}

	}
}
