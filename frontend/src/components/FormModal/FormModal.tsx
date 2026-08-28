/**
 * FormModal：schema 驱动的弹窗表单，只依赖 antd 一手 API（Modal + Form + Row/Col），
 * 用于替代 @ant-design/pro-components 的 ModalForm + ProFormXxx。
 *
 * 行为约定（与 ModalForm 等价）：
 *   受控 open；点确定 → form.validateFields()（失败红字提示且不关闭）
 *   → await onFinish(values) → 返回值 !== false 才关闭并 resetFields；
 *   onFinish 抛错则捕获、不关闭（由调用方 message 提示）；
 *   提交中确定按钮 loading；open 重新打开时按 initialValues 重置表单。
 */
import { useEffect, useRef, useState } from 'react'
import { Col, DatePicker, Form, Input, InputNumber, Modal, Row, Select } from 'antd'

export interface FormModalField {
  name: string
  label: string
  type: 'input' | 'password' | 'textarea' | 'number' | 'select' | 'date' | 'dateRange'
  /** Col span，默认 12（一行两个），textarea 类默认 24 */
  span?: number
  /** 必填，会自动合成一条 required rule（message 按控件类型生成） */
  required?: boolean
  /** 额外 antd rules */
  rules?: any[]
  options?: { label: string; value: any }[]
  showSearch?: boolean
  /** select 多选模式 */
  multiple?: boolean
  /** 条件渲染：返回 false 时该字段不渲染（也不参与校验） */
  visibleWhen?: (values: Record<string, any>) => boolean
  min?: number
  max?: number
  precision?: number
  rows?: number
  placeholder?: string
}

export interface FormModalProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  fields: FormModalField[]
  onFinish: (values: Record<string, any>) => Promise<boolean | void> | boolean | void
  /** 编辑时传入；open 变化时重置表单 */
  initialValues?: Record<string, any>
  width?: number
  okText?: string
}

/** 按控件类型生成默认的必填提示 / placeholder 动词 */
const ACTION_VERB: Record<FormModalField['type'], string> = {
  input: '请输入',
  password: '请输入',
  textarea: '请输入',
  number: '请输入',
  select: '请选择',
  date: '请选择',
  dateRange: '请选择',
}

/**
 * 注意：Form.Item 通过 cloneElement 向直接子组件注入 value/onChange，
 * 这里必须接收并透传给底层 antd 控件，否则输入不会注册进表单，
 * validateFields 永远拿不到值（表现为"填了还说没填"）。
 */
function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FormModalField
  value?: any
  onChange?: (...args: any[]) => void
}) {
  const bind = { value, onChange }
  const placeholder = field.placeholder ?? `${ACTION_VERB[field.type]}${field.label}`
  switch (field.type) {
    case 'password':
      return <Input.Password {...bind} placeholder={placeholder} />
    case 'textarea':
      return <Input.TextArea {...bind} rows={field.rows ?? 3} placeholder={placeholder} />
    case 'number':
      return (
        <InputNumber
          {...bind}
          style={{ width: '100%' }}
          min={field.min}
          max={field.max}
          precision={field.precision}
          placeholder={placeholder}
        />
      )
    case 'select':
      return (
        <Select
          {...bind}
          mode={field.multiple ? 'multiple' : undefined}
          options={field.options}
          showSearch={field.showSearch}
          optionFilterProp="label"
          placeholder={placeholder}
        />
      )
    case 'date':
      return <DatePicker {...bind} style={{ width: '100%' }} placeholder={placeholder} />
    case 'dateRange':
      return <DatePicker.RangePicker {...bind} style={{ width: '100%' }} />
    default:
      return <Input {...bind} placeholder={placeholder} />
  }
}

export function FormModal({
  title,
  open,
  onOpenChange,
  fields,
  onFinish,
  initialValues,
  width = 560,
  okText = '确定',
}: FormModalProps) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  // 监听全部字段值，驱动 visibleWhen 条件字段的显隐
  const watchedValues = Form.useWatch([], form)
  const initialValuesRef = useRef(initialValues)
  initialValuesRef.current = initialValues

  // open 变化（重新打开）时重置表单并回显 initialValues
  useEffect(() => {
    if (open) {
      form.resetFields()
      if (initialValuesRef.current) {
        form.setFieldsValue(initialValuesRef.current)
      }
    }
    // 仅在 open 变化时触发，initialValues 经 ref 取最新值，避免每次渲染重置用户输入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleOk = async () => {
    let values: Record<string, any>
    try {
      values = await form.validateFields()
    } catch {
      // 校验失败：红字由 Form 展示，弹窗不关闭
      return
    }
    setSubmitting(true)
    try {
      const result = await onFinish(values)
      if (result !== false) {
        onOpenChange(false)
        form.resetFields()
      }
    } catch {
      // onFinish 抛错：不关闭弹窗，由调用方 message 提示
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={title}
      open={open}
      width={width}
      okText={okText}
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnHidden
      onOk={handleOk}
      onCancel={() => onOpenChange(false)}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          {fields.map((field) => {
            if (field.visibleWhen && !field.visibleWhen(watchedValues ?? {})) return null
            const rules = [...(field.rules ?? [])]
            if (field.required && !rules.some((r) => r?.required)) {
              rules.unshift({ required: true, message: `${ACTION_VERB[field.type]}${field.label}` })
            }
            return (
              <Col key={field.name} span={field.span ?? (field.type === 'textarea' ? 24 : 12)}>
                <Form.Item name={field.name} label={field.label} rules={rules}>
                  <FieldControl field={field} />
                </Form.Item>
              </Col>
            )
          })}
        </Row>
      </Form>
    </Modal>
  )
}

export default FormModal
